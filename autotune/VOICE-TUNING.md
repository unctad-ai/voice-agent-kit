# Voice Experience Auto-Tuning

Autonomous parameter optimization for voice agent conversation quality.
Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch).

## How It Works

```
LOOP FOREVER:
  1. Read queue.tsv → pick next parameter
  2. Read the source file → understand current value
  3. Change ONE parameter within its safe range
  4. Rebuild kit: pnpm build
  5. Rebuild Docker: pnpm docker:kenya
  6. Run headless eval: node scripts/test-pipeline.mjs
  7. Score 0-100 from eval output
  8. If score > baseline + 2 → keep (commit). Otherwise → discard (git reset)
  9. Log to results.tsv
  10. NEVER STOP
```

## Quick Start

```bash
# 1. Prerequisites
#    - Docker Desktop running
#    - Swkenya at ../Swkenya with server/.env configured (matching production)
#    - GPU endpoints reachable (STT + TTS)

# 2. Create worktree (isolate tuning work)
git worktree add -b autotune/$(date +%b%d | tr A-Z a-z) .claude/worktrees/autotune

# 3. Build and start
cd .claude/worktrees/autotune
pnpm install && pnpm build
pnpm docker:kenya

# 4. Verify baseline
node scripts/test-pipeline.mjs ws://localhost:3001/api/voice

# 5. Launch the loop
/loop 20m <paste prompt below>
```

## The Loop Prompt

Copy-paste this into `/loop 20m`:

```
Work in the voice-agent-kit autotune worktree.

YOU ARE TUNING A VOICE ASSISTANT FOR OPTIMAL CONVERSATION EXPERIENCE.

CONTEXT:
- Read autotune/results.tsv to see what's been done and the current baseline score.
- Read autotune/queue.tsv for the next parameter to try (first line not marked DONE).
- The baseline is the score from the last "keep" row (or "baseline" row if first run).

FILES YOU CAN MODIFY (and ONLY these):
- packages/core/src/config/defaults.ts — VAD, barge-in, timeouts, thresholds
- packages/server/src/systemPrompt.ts — response rules, tone, format constraints
- packages/server/src/voicePipeline.ts — LLM_TIMEOUT_MS, MAX_TOOL_ROUNDS, CLIENT_TOOL_TIMEOUT_MS
- packages/server/src/ttsProviders.ts — TTS provider timeouts, speeds, expressiveness

RULES (adapted from karpathy/autoresearch):
- Change ONE parameter per iteration. Never change multiple at once.
- Read the current value before changing. Understand what it does.
- Stay within the range documented in queue.tsv.
- NEVER STOP. NEVER ASK. Run until manually interrupted.

PROCEDURE:
1. Pop next parameter from queue.tsv (first line not marked DONE).
2. Check the "method" column:

   IF method = "ws" (runtime-configurable):
   - The eval script will send the new value via session.update
   - Modify test-pipeline.mjs to include the parameter in the session.update message
   - No rebuild needed — just re-run eval
   - Example: expressiveness → add voice_settings.expressiveness to session.update

   IF method = "rebuild" (hardcoded):
   - Read and modify the source file
   - Rebuild: pnpm build > /dev/null 2>&1
   - Rebuild Docker: pnpm docker:kenya 2>&1 | tail -3
   - Wait for container: sleep 5

3. Run eval: node scripts/test-pipeline.mjs ws://localhost:3001/api/voice > /tmp/eval.log 2>&1
4. Read /tmp/eval.log and score:

   SCORING RUBRIC (0-100):

   CORRECTNESS (40 points):
   - Count PASS lines in eval output. Each PASS = 6.67 points (6 tests × 6.67 = 40)
   - A FAIL scores 0 for that test

   RESPONSE LATENCY (25 points):
   - Extract elapsed times from PASS lines (e.g., "PASS (1234ms)")
   - Average across all passing tests
   - 25 if avg < 3000ms; linear decay: 25 * max(0, (8000 - avg) / 5000); 0 if avg > 8000ms

   TTS AUDIO (15 points):
   - Count tests with "+NKB audio" in output (non-zero audio bytes)
   - 15 if all non-SILENT tests produced audio; proportional otherwise
   - SILENT test should NOT produce audio

   NO ERRORS (10 points):
   - 10 if no "error:" lines in eval output; 0 if any errors

   SILENT ACCURACY (10 points):
   - 10 if the filler test ("hmm yeah okay") correctly returned SILENT
   - 0 if it triggered a real response

   TOTAL = sum, clamped to [0, 100]

9. KEEP/DISCARD:
   - If score >= baseline + 2:
       git add -A
       git commit -m "tune: {param} {old_value} -> {new_value} (score: {score})"
       Mark as DONE in queue.tsv
       Update baseline in results.tsv
   - If score < baseline + 2:
       git checkout -- . (discard all changes)
       Log as "discard" in results.tsv
   - If Docker build fails or eval crashes:
       git checkout -- . (discard)
       Log as "crash" in results.tsv

10. Append a row to autotune/results.tsv with ALL fields.
11. NEVER STOP. Pop next parameter from queue.tsv.
    If queue exhausted: revisit parameters that produced "keep" with finer steps,
    OR try combining two kept changes (pair sweep — see below).
```

## Scoring Rubric Summary

| Dimension | Weight | Source |
|-----------|--------|--------|
| Correctness | 40 | PASS/FAIL count from test-pipeline.mjs |
| Response Latency | 25 | Elapsed ms per query |
| TTS Audio | 15 | Audio bytes > 0 for non-SILENT tests |
| No Errors | 10 | No error lines in output |
| SILENT Accuracy | 10 | Filler correctly detected |

**Keep threshold:** score must exceed baseline by **at least 2 points**.

## Parameter Interaction (Pair Sweep)

After the greedy single-parameter pass, parameters that interact should be tested together:

| Pair | Why |
|------|-----|
| `positiveSpeechThreshold` + `negativeSpeechThreshold` | Their gap is the VAD hysteresis band |
| `BARGE_IN.threshold` + `UNINTERRUPTIBLE_WINDOW_MS` | Together determine interrupt behavior |
| `redemptionMs` + `minSpeechMs` | Together determine end-of-speech detection |
| `systemPrompt.wordLimit` + `systemPrompt.sentenceLimit` | Together control response verbosity |
| `luxTtsSpeed` + `luxTtsTShift` | Together control LuxTTS voice character |

For each pair: test combined change vs. each alone. Keep the best of the three.

## Eval Infrastructure

### `scripts/test-pipeline.mjs` (headless, no browser)

Tests the full pipeline via WebSocket `text.submit` — bypasses STT entirely:
- 6 test scenarios: general Q, navigation, search, category browse, filler ([SILENT]), politeness
- Measures: response time, tool call accuracy, TTS audio bytes, per-turn timings
- Mock tool results for searchServices, listServicesByCategory, getServiceDetails, navigateTo
- 30s timeout per query, returns exit code 0 (all pass) or 1 (any fail)

```bash
node scripts/test-pipeline.mjs ws://localhost:3001/api/voice
```

### `scripts/test-tts.mjs` (TTS-only)

Tests TTS provider latency and streaming independently:
- TTFA (time-to-first-audio), total latency, audio format
- Cancel recovery (abort mid-stream, retry)
- GPU lock watchdog validation

```bash
node scripts/test-tts.mjs http://localhost:3001
```

### Docker workflow (`pnpm docker:kenya`)

Builds kit from local source + starts Swkenya in Docker:
- No npm link, no React dedup issues, no module resolution problems
- Layer caching makes rebuilds fast (only changed kit files re-build)
- Backend on port 3001, frontend on port 3000

## Known Limitations

- **Non-deterministic:** LLM responses vary per run. Run eval 2-3 times and take median for noisy parameters.
- **Overfitting risk:** 6 test queries is narrow. Validate tuned params with full `/test-voice` investor journey.
- **Greedy search:** One-at-a-time misses interaction effects. Pair sweep partially mitigates.
- **Docker rebuild time:** ~30s per iteration (cached). Budget this into the 20m loop window.
- **Cost:** Each iteration uses Claude tokens + Groq API calls + GPU TTS/STT calls.
- **VAD params not testable headless:** VAD thresholds only matter with real audio. `test-pipeline.mjs` uses `text.submit` which bypasses VAD. VAD tuning requires `/test-voice` with a microphone.
