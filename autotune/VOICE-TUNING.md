# Voice Experience Auto-Tuning

Autonomous parameter optimization for voice agent conversation quality.
Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch).

## How It Works

```
LOOP FOREVER:
  1. Read queue.tsv → pick next parameter
  2. Read the source file → understand current value
  3. Change ONE parameter within its safe range
  4. Rebuild: pnpm build
  5. Start local Swkenya → run 5 test queries via browser
  6. Score 0-100 (correctness, quality, latency, stability)
  7. If score > baseline + 2 → keep (commit). Otherwise → discard (git reset)
  8. Log to results.tsv
  9. NEVER STOP
```

## Quick Start

```bash
# 1. Prerequisites
#    - Chrome with claude-in-chrome extension running
#    - Swkenya cloned at ../Swkenya with .env configured
#    - GPU endpoints reachable (STT + TTS)

# 2. Create worktree (isolate tuning work)
git worktree add -b autotune/$(date +%b%d | tr A-Z a-z) .claude/worktrees/autotune

# 3. Build and link into Swkenya
cd .claude/worktrees/autotune
pnpm install && pnpm build
./autotune/link-to-swkenya.sh

# 4. Establish baseline
#    Launch the loop — first iteration scores current defaults as baseline
/loop 20m Follow the instructions in autotune/VOICE-TUNING.md exactly.
```

## The Loop Prompt

Copy-paste this into `/loop 20m`:

```
Follow the instructions in .claude/worktrees/autotune/autotune/VOICE-TUNING.md.

Work in .claude/worktrees/autotune/ on the current branch.

YOU ARE TUNING A VOICE ASSISTANT FOR OPTIMAL CONVERSATION EXPERIENCE.

CONTEXT:
- Read autotune/results.tsv to see what's been done and the current baseline score.
- Read autotune/queue.tsv for the next parameter to try.
- The baseline is the score from the last "keep" row (or "baseline" row if first run).

FILES YOU CAN MODIFY (and ONLY these):
- packages/core/src/config/defaults.ts — VAD, barge-in, timeouts, thresholds
- packages/server/src/systemPrompt.ts — response rules, tone, format constraints
- packages/server/src/voicePipeline.ts — MAX_TOOL_ROUNDS, CLIENT_TOOL_TIMEOUT_MS
- packages/server/src/ttsProviders.ts — TTS provider timeouts

RULES:
- Change ONE parameter per iteration. Never change multiple at once.
- Read the current value before changing. Understand what it does.
- Stay within the range documented in queue.tsv.
- After changing: pnpm build > /dev/null 2>&1

EVALUATION:
1. Start Swkenya backend:
   cd $PROJECT_ROOT/Swkenya/server && npx tsx index.ts > /dev/null 2>&1 &
   SERVER_PID=$!
   sleep 3
   curl -sf localhost:3001/api/health || (kill $SERVER_PID; echo "BACKEND DOWN"; exit 1)

2. Open browser tab to http://localhost:5173

3. Run 5 test queries via the text composer (use data-testid="voice-agent-input" and data-testid="voice-agent-send"):

   Q1: "What investor services are available?"
       Expect: summary of services, NO tool card, conversational tone
   Q2: "Tell me about Tax Registration PIN"
       Expect: searchServices tool card, specific content about KRA/PIN
   Q3: "Take me to the application form"
       Expect: navigation tool card, URL changes
   Q4: "Thank you for the help"
       Expect: warm reply, NO tool call, NOT a farewell/close
   Q5: "What categories of services do you offer?"
       Expect: listServicesByCategory tool card, category summary

   For each query:
   - Record time from send to first bot text appearing (data-testid="voice-agent-transcript")
   - Read the response text
   - Check for tool cards in transcript

4. Score using this rubric:

   CORRECTNESS (35 points):
   - 7 points per query where the expected behavior occurred
   - Q1: response mentions services/investment, no tool card
   - Q2: searchServices tool card appeared, response mentions PIN/KRA/tax
   - Q3: navigation tool card appeared, URL changed
   - Q4: warm reply, no tool call, no farewell/close behavior
   - Q5: listServicesByCategory tool card appeared, mentions categories

   RESPONSE QUALITY (20 points):
   - 20 if ALL responses: no emoji, no markdown (**,|,#,`), no HTML tags, length 30-300 chars
   - -5 per violation type found across all responses

   RESPONSE LATENCY (20 points):
   - Average response time across all 5 queries
   - 20 if avg < 3s; linear decay: 20 * max(0, (8 - avg) / 5); 0 if avg > 8s

   NO FALSE TRIGGERS (15 points):
   - 15 if no unexpected messages appeared in transcript between queries
   - 0 if any spurious bot message appeared

   STABILITY (10 points):
   - If this is a re-run: 10 * max(0, 1 - abs(this_score - last_score) / 10)
   - If first run: 10

   TOTAL = sum, clamped to [0, 100]

5. Kill Swkenya: kill $SERVER_PID 2>/dev/null

KEEP/DISCARD:
- If score >= baseline + 2:
    git add -A
    git commit -m "tune: {param} {old_value} -> {new_value} (score: {score})"
    Update baseline in results.tsv
- If score < baseline + 2:
    git checkout -- . (discard all changes)
    Log as "discard" in results.tsv

AFTER EACH ITERATION:
- Append a row to autotune/results.tsv with ALL fields
- Move to next parameter in queue.tsv
- If queue exhausted: revisit parameters that produced "keep" with finer steps,
  OR try combining two kept changes (pair sweep)

NEVER STOP. NEVER ASK. Run until manually interrupted.
```

## Scoring Rubric Summary

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| Correctness | 35 | Right tool called, right content in response |
| Response Quality | 20 | No emoji/markdown/HTML, appropriate length |
| Response Latency | 20 | Time to first bot text |
| No False Triggers | 15 | No spurious bot messages |
| Stability | 10 | Score consistency across runs |

**Keep threshold:** score must exceed baseline by **at least 2 points** (noise floor).

## Parameter Interaction (Pair Sweep)

After the greedy single-parameter pass, parameters that interact should be tested together:

| Pair | Why |
|------|-----|
| `positiveSpeechThreshold` + `negativeSpeechThreshold` | Their gap is the VAD hysteresis band |
| `BARGE_IN.threshold` + `UNINTERRUPTIBLE_WINDOW_MS` | Together determine interrupt behavior |
| `redemptionMs` + `minSpeechMs` | Together determine end-of-speech detection |
| `systemPrompt.wordLimit` + `systemPrompt.sentenceLimit` | Together control response verbosity |

For each pair: test combined change vs. each alone. Keep the best of the three.

## Known Limitations

- **Non-deterministic:** LLM responses vary per run. Median of 3 helps but doesn't eliminate noise.
- **Overfitting risk:** 5 test queries is narrow. Validate tuned params with full `/test-voice` journey.
- **Greedy search:** One-at-a-time misses interaction effects. Pair sweep partially mitigates.
- **Browser required:** Needs Chrome + claude-in-chrome. Extract to Playwright for CI later.
- **Cost:** Each iteration uses Claude tokens + Groq API + GPU STT/TTS calls.
