# TTS Graceful Degradation

**Date:** 2026-03-18
**Status:** Specced
**Priority:** Medium — prevents silent crashes in containerized deployments

## Problem

If the selected TTS provider has no URL configured (e.g. `LUXTTS_URL` empty), the server throws at call time: `TTS provider "luxtts" has no URL configured`. In containerized deployments, this crashes the voice turn silently — the user gets no audio and no explanation.

## Changes

### 1. Detect TTS availability at startup

**File:** `packages/server/src/createVoiceWebSocketHandler.ts`

After building `ttsConfig` (~line 76), check if the selected provider's URL is set:

```ts
const ttsAvailable = Boolean(providerUrls[ttsConfig.ttsProvider]);
```

Use the same `providerUrls` mapping from `ttsProviders.ts` (or extract it). Pass `ttsAvailable` to `VoicePipeline`.

### 2. Include in health check response

**File:** `packages/core/src/services/voiceWebSocket.ts` (or wherever `checkBackendHealth`/`checkPipelineHealth` lives)

Add `ttsAvailable: boolean` to the health check response. The FAB health poll and panel retry logic already call this — they'll get TTS status for free.

### 3. Include in session.created event

**File:** `packages/server/src/protocol.ts` (or events definition)

Add `ttsAvailable: boolean` to the `session.created` event payload so the client knows on WebSocket connect.

### 4. Skip TTS in voice pipeline when unavailable

**File:** `packages/server/src/voicePipeline.ts`

When `ttsAvailable` is false, skip TTS synthesis — still run STT → LLM but send text-only responses (no audio frames). The existing `<silent/>` and empty-text checks are the pattern to follow.

### 5. Client reads ttsAvailable from session.created

**File:** `packages/core/src/hooks/useVoiceWebSocket.ts`

Read `ttsAvailable` from the `session.created` event. Expose it in the hook return.

### 6. Client forces muted state when TTS unavailable

**File:** `packages/core/src/hooks/useVoiceAgent.ts`

When server reports `ttsAvailable: false`, force the same state as `ttsEnabled: false` — muted avatar, text responses still display.

Effective TTS state = `ttsAvailable AND ttsEnabled` (server capability AND user preference).

### 7. Keep safety net

**File:** `packages/server/src/ttsProviders.ts`

The error throw for missing URLs stays as-is — it's a safety net in case a TTS call is somehow attempted despite the flag.

## Testing

- Start server with `LUXTTS_URL` unset → health check returns `ttsAvailable: false`
- Connect via WebSocket → `session.created` includes `ttsAvailable: false`
- Voice turn completes with text-only response, no crash
- Avatar shows muted state
- Set `LUXTTS_URL` and restart → everything works normally
