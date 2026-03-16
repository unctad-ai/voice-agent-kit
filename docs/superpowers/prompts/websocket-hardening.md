# WebSocket Voice Pipeline Hardening

## Context

We built a WebSocket voice pipeline (v2.0.x) replacing the HTTP REST STT/LLM/TTS pipeline. The architecture is sound — STT→LLM→TTS works end-to-end. But the implementation has integration bugs at the WebSocket plumbing level that need hardening before it's reliable.

**Read first:** Check memory at `project_websocket_pipeline_bugs.md` — it has every bug found, every fix applied, and the 6 hardening tasks.

## What exists

- `packages/server/src/voicePipeline.ts` — STT→LLM→TTS orchestrator
- `packages/server/src/sttStreamClient.ts` — WebSocket client to Python STT
- `packages/server/src/createVoiceWebSocketHandler.ts` — Express WebSocket upgrade handler
- `packages/core/src/hooks/useVoiceAgent.ts` — Client-side pipeline hook (rewritten)
- `packages/core/src/services/voiceWebSocket.ts` — Browser WebSocket manager
- `packages/core/src/hooks/useAudioPlayback.ts` — PCM chunk playback
- `gpu-services/kyutai-stt/server.py` — Python STT with WebSocket batched inference (separate repo)

## Local dev setup (already configured)

```bash
# Terminal 1: Backend (Express + WebSocket)
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya/server
npx tsx --env-file=.env index.ts
# Runs on port 3001, connects to GPU STT at 5.9.49.171:8003

# Terminal 2: Frontend (Vite dev server)
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya
npx vite
# Runs on port 3000, proxies API to localhost:3001

# After kit changes:
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build
# Then restart backend (Swkenya/server uses file: link to local kit)
```

## Audio format chain (document this in code)

```
Browser mic → Float32, 16kHz, 256 samples/frame (VAD hop)
  ↓ buffer 5 frames, resample via OfflineAudioContext
Client → Server WS → Float32 binary, 24kHz, 1920 samples/frame
  ↓ forward to STT
Server → STT WS → Float32 binary, 24kHz, 1920 samples
  ↓ inference
STT → Server → JSON events (word, vad, done)
  ↓ LLM call
Server → TTS HTTP → text string
  ↓ synthesis
TTS → Server HTTP → Int16 PCM WAV (24kHz, 16-bit, mono, 44-byte header)
  ↓ strip header
Server → Client WS → Int16 PCM binary (no header)
  ↓ convert
Client playback → Int16→Float32 conversion → AudioBufferSourceNode
```

## 6 hardening tasks

### 1. WebSocket state machine
Both `SttStreamClient` (server) and `VoiceWebSocketManager` (client) need proper state tracking. Current code uses try/catch as a state machine — every `close()`, `terminate()`, `send()` call can crash on invalid states. Implement: CONNECTING → OPEN → CLOSING → CLOSED enum, guard every operation.

### 2. AsyncQueue for STT results
Replace `sttDoneResolve` naked promise pattern in `voicePipeline.ts` with an AsyncQueue. Current pattern: expose a `resolve` function, resolve from external callback. Breaks on racing turns, multiple commits, connection drops. Study Unmute's `QuestManager` pattern in `unmute/unmute_handler.py` from https://github.com/kyutai-labs/unmute for inspiration.

### 3. Turn boundary protocol
Client keeps streaming audio after `commit`. Server receives thousands of useless frames. After commit, client should stop sending audio until the turn completes and state returns to LISTENING. Server should ignore audio frames during PROCESSING/SPEAKING.

### 4. Uninterruptible window
Steal from Unmute: 3-second `UNINTERRUPTIBLE_BY_VAD_TIME_SEC` after bot starts speaking. Prevents echo-cancellation false triggers from TTS playback being picked up by the mic and firing spurious commits.

### 5. Audio buffering for playback
Current `playPcmChunk` schedules audio immediately without buffering. Causes choppy playback. Study Unmute's `RealtimeQueue` — heap-based priority queue with 4-frame buffer. Implement similar buffering in `useAudioPlayback.ts`.

### 6. Error propagation
Audit every async call in the pipeline. Every `startTurn()`, every WebSocket `.send()`, every `streamText()`, every TTS fetch needs proper error handling. No fire-and-forget promises. Unhandled rejections crash Node.

## Skills to use (in order)

1. **superpowers:systematic-debugging** — Reproduce each bug locally first
2. **superpowers:test-driven-development** — Write failing test, then implement fix
3. **superpowers:verification-before-completion** — Prove it works in browser before committing
4. **superpowers:requesting-code-review** — Review before any npm release

## Patterns to study from Unmute

Read these files from https://github.com/kyutai-labs/unmute:
- `unmute/unmute_handler.py` — `QuestManager` (task cancellation), `UNINTERRUPTIBLE_BY_VAD_TIME_SEC` (echo guard), `RealtimeQueue` (audio buffering)
- `unmute/stt/speech_to_text.py` — How they handle STT WebSocket lifecycle cleanly

## Definition of done

- All 6 hardening tasks implemented with tests
- Full voice loop works locally: speak → transcript appears → LLM responds → TTS plays back → returns to listening
- No server crashes on connect/disconnect cycles
- No stuck "Processing" state
- Clean audio playback (no clicks, pops, or distortion)
- `pnpm build && pnpm typecheck && pnpm test` all pass
- Then and only then: release + deploy via `./scripts/release.sh --yes` and `cd ../singlewindow-deployments && ./scripts/update-all.sh`
