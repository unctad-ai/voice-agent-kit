# Cancel Processing — Design Spec

## Problem

When the voice agent is in PROCESSING state (LLM inference, tool loops), the user
cannot interrupt, cancel, or start a new interaction. The mic button silently
swallows clicks, and there's no affordance to indicate cancellation is possible.
On slow connections or during multi-tool chains, users wait 5-15s with no exit.

## Design Constraints

- No new UI elements — extend existing mic and keyboard buttons
- Non-intrusive for fast responses (< 2s) — only hint at cancelability when needed
- Works in both expanded panel and collapsed bar
- Must cancel cleanly on both client (abort WS turn) and server (abort pipeline)

## Solution

### 1. Extend `handleMicToggle` to PROCESSING and AI_SPEAKING

Currently handles only IDLE, LISTENING, USER_SPEAKING. Add:

- **PROCESSING**: cancel current turn → go to LISTENING (start mic)
- **AI_SPEAKING**: cancel TTS + response → go to LISTENING (start mic)

Implementation: call `stop()` (which aborts the WS turn) then `start()`.

### 2. Extend keyboard button to cancel during PROCESSING/AI_SPEAKING

Currently switches to text mode without canceling. Add:

- If state is PROCESSING or AI_SPEAKING: call `stop()` first, then switch to text mode.

### 3. Progressive label hint

After 2 seconds in PROCESSING state, animate the status label:

- "Thinking..." → "Tap mic to cancel"
- Use the existing `AnimatePresence` label transition (already cross-fades on voiceState change)
- Timer resets when state leaves PROCESSING

No label change during AI_SPEAKING — barge-in already works there and the existing
"Responding..." label is sufficient since the user can naturally speak over it.

### 4. Collapsed bar

The collapsed bar already forwards `onMicToggle` to the same handler. The fix
propagates automatically — no additional work needed.

## Files to Change

| File | Change |
|------|--------|
| `packages/ui/src/components/GlassCopilotPanel.tsx` | Extend `handleMicToggle` to handle PROCESSING/AI_SPEAKING states; add cancel-before-switch in keyboard button click; add 2s timer for label hint |
| `packages/core/src/hooks/useVoiceAgent.ts` | Verify `stop()` properly aborts during PROCESSING (it already does via AbortController) |

## Edge Cases

- **Fast responses (< 2s)**: Label stays "Thinking...", no cancel hint shown. No visual noise.
- **Cancel during tool loop**: Server AbortController cancels mid-tool-chain. Client discards partial response.
- **Cancel then immediate speak**: `stop()` + `start()` in sequence. The `start()` call resets state machine cleanly.
- **Double-tap**: Second tap during LISTENING after cancel is a normal stop — no special handling needed.
- **Text cancel during PROCESSING**: `stop()` aborts the turn, mode switches to text. Old response fragments won't arrive (WS disconnected by stop).

## Not In Scope

- New stop/cancel button or icon — reuse existing mic button
- Cancel animation or progress indicator — keep it minimal
- Server-side cancel confirmation event — the existing AbortController pattern is sufficient
