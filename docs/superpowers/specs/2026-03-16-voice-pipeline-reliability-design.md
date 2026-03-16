# Voice Pipeline Reliability: Observability + Hardening

**Date:** 2026-03-16
**Status:** Approved
**Scope:** `packages/server/src/voicePipeline.ts` only

## Problem

Voice pipeline works for 1-2 turns then fails by turn 2-3 with silent hangs (LLM never responds) or TTS drops (text generated but no audio). Users experience non-deterministic behavior — same input, different failure modes each time.

## Root Cause Hypothesis

State corruption accumulates across turns: pending tool call promises leak, STT queue holds stale results, overlapping turns race. No timeouts on LLM or TTS mean failures manifest as infinite silence.

## Design

### 1. Turn Tracing (~6 console.log per turn)

Each turn gets a `turnId` (incrementing counter). Existing log lines are replaced with a consistent format:

```
[turn:{id}] {stage}:{event} {details} ({durationMs}ms)
```

Events emitted at existing pipeline boundaries:
- `turn:start` — turn begins
- `stt:done` — transcript received (or filtered)
- `llm:start` — calling model
- `llm:tool` — tool call detected (one per tool)
- `llm:done` — text response complete
- `tts:done` — audio streaming complete (or skipped)
- `turn:done` — turn fully complete
- `turn:error` — unrecoverable error

No new abstractions. A `turnId` counter on the class + string interpolation in existing log sites.

### 2. LLM Timeout (15s)

Wrap the `runLlmLoop` call in `startTurn` with `AbortSignal.timeout(15_000)` combined with the existing turn abort signal using `AbortSignal.any()`.

On timeout:
1. Log `[turn:{id}] llm:timeout (15000ms)`
2. Set `assistantText` to a fallback: `"Sorry, I could not process that. Could you try again?"`
3. Continue to TTS with the fallback text
4. Pipeline proceeds normally to LISTENING

### 3. TTS Graceful Degradation

Wrap the `streamTtsAudio` call in a try/catch (currently throws on failure).

On TTS failure:
1. Log `[turn:{id}] tts:error {message}`
2. Send `response.audio.done` (empty — so client knows audio phase is over)
3. The text response was already sent via `response.text.done` — user sees transcript
4. Continue to LISTENING

Result: user sees the text response and hears nothing, instead of getting stuck.

### 4. State Hygiene (3 guards)

**4a. Abort overlap:** At the top of `startTurn`, if `this.abortController` is not null, call `this.cancel()` before creating a new one. Prevents two turns running concurrently.

**4b. Clear pending tools in finally:** In the `startTurn` finally block, resolve any remaining entries in `pendingToolCalls` with `{ error: 'turn_ended' }` and clear the map.

**4c. Drain STT queue:** After creating the new AbortController in `startTurn`, drain any buffered STT results from previous turns by calling `this.sttQueue.drain()`. Add a `drain()` method to AsyncQueue that discards all buffered items.

## Files Changed

| File | Changes |
|---|---|
| `packages/server/src/voicePipeline.ts` | All 4 sections above |
| `packages/server/src/asyncQueue.ts` | Add `drain()` method |

## What This Does NOT Change

- No new files or classes
- No changes to the client (core/ui/registries packages)
- No changes to system prompt, tools, or TTS providers
- No retry logic or circuit breakers
- No external dependencies

## Success Criteria

- Same query repeated 10 times in a row completes all 10 turns without hanging
- TTS failure produces text-only response instead of silent hang
- LLM timeout produces fallback response within 15s
- Turn 5+ of a conversation works as reliably as turn 1
- All failures are visible in logs with turnId + stage + duration
