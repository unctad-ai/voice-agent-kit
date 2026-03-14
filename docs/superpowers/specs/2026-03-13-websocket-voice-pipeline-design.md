# WebSocket Voice Pipeline Design

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Breaking change — replaces HTTP REST STT/LLM/TTS pipeline with WebSocket

## Summary

Replace the current HTTP REST architecture (3 separate endpoints: `/api/stt`, `/api/tts`, `/api/chat`) with a single persistent WebSocket connection that streams audio bidirectionally and orchestrates STT→LLM→TTS entirely server-side. This eliminates per-turn HTTP overhead, enables streaming STT (audio processed as user speaks), and reduces voice round-trip latency from ~3-6s to ~1.5-3s.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport | Single WebSocket, clean break (no REST fallback) | Simplest codebase, no dual maintenance |
| Protocol | OpenAI Realtime API base + `voice-agent.*` extensions | Ecosystem compatibility where it maps, custom where needed |
| STT service | Upgrade existing Python server (not Rust moshi-server) | Already streams frame-by-frame internally, we own the code, keep VAD integration |
| Audio codec | Raw PCM float32 (no Opus) | Marginal bandwidth savings at our scale don't justify codec complexity + Safari polyfills |
| WebSocket framing | Binary frames for audio, JSON for events | Avoids 33% base64 overhead on PCM data |
| Client architecture | Server-initiated LLM (no HTTP round-trip for chat) | Lowest latency — STT→LLM happens server-side |
| Session state | Client is source of truth, server stateless | Resilient to restarts, no session store needed |
| Server API | `attachVoicePipeline(server, options)` — single export | Consuming projects don't touch pipeline internals. Takes `VoiceServerOptions` (same shape as current `createVoiceRoutes`). |
| STT concurrency | Batched inference (default batch_size=4) | 4 concurrent users across all deployments on RTX 4000 Ada (12.7GB VRAM free) |

## Fact-Checked Corrections

These findings from fact-checking overrode original assumptions:

- **STT latency is ~1-2s, not 5-12s.** The Python STT server already does frame-by-frame streaming inference via `LMGen.step_with_extra_heads()`. The bottleneck is the client sending full WAV blobs.
- **Rust moshi-server is NOT drop-in.** Uses custom MessagePack protocol, no OpenAI-compatible API. Would need an adapter layer. Not worth it at our scale.
- **`useChat` from `@ai-sdk/react` is HTTP/SSE only.** No WebSocket transport. Replacing it is a necessary part of this change.
- **Opus bandwidth savings are ~10x (not 24x)** and only ~145KB per utterance in batch mode. Compelling only for continuous streaming, not worth the Safari polyfill risk.

## Architecture

### Current Flow (~3-6s per turn)
```
Browser → VAD captures full segment → encode WAV → POST /api/stt → wait →
POST /api/chat (useChat HTTP/SSE) → wait → POST /api/tts → stream audio back
```

### New Flow (~1.5-3s per turn)
```
Browser ←── single WebSocket ──→ Express (stateless bridge)
                                      ↕ WebSocket (new)
                                  Python STT GPU
                                      ↕ HTTP streaming (unchanged)
                                  Groq LLM
                                      ↕ HTTP streaming (unchanged)
                                  TTS GPU
```

### Data Flow

1. Browser opens WebSocket to Express at `/api/voice`
2. Client sends `session.update` with conversation history and config
3. TEN VAD runs client-side, streams raw PCM frames to server via `input_audio_buffer.append`
4. Server forwards PCM to Python STT over WebSocket — STT emits partial transcripts + VAD scores
5. When client VAD detects speech end, sends `input_audio_buffer.commit`
6. Server calls Groq LLM with transcript + conversation history (server-side, no HTTP round-trip to client)
7. LLM response tokens stream to TTS word-by-word
8. TTS audio chunks stream back to client as `response.audio.delta` events
9. Client plays PCM chunks via AudioBufferSourceNode with sample-exact scheduling
10. For client tools: server sends `voice-agent.tool_call`, client executes, returns `voice-agent.tool_result`, server feeds result to LLM

## WebSocket Protocol

### Connection

`ws://{host}/api/voice` — upgrades from Express HTTP server via `ws` package.

### Client → Server Events

| Event | Purpose | Payload |
|-------|---------|---------|
| `session.update` | Init/restore session | `{ conversation: Message[], config: SiteConfig, voice_settings: VoiceSettings, language?: string }` |
| `input_audio_buffer.append` | Stream mic PCM | Binary frame: raw Float32 PCM bytes (no JSON wrapper) |
| `input_audio_buffer.commit` | VAD detected speech end | `{}` |
| `input_audio_buffer.clear` | User cancelled / reset | `{}` |
| `response.cancel` | Barge-in / abort | `{}` |
| `voice-agent.tool_result` | Client tool completed | `{ tool_call_id: string, result: any }` |

### Server → Client Events

| Event | Purpose | Payload |
|-------|---------|---------|
| `session.created` | Connection ack | `{ session_id: string }` |
| `input_audio_buffer.speech_started` | STT detected speech | `{}` |
| `input_audio_buffer.speech_stopped` | STT VAD fired | `{}` |
| `conversation.item.created` | New message (user or assistant) | `{ message: Message }` |
| `response.text.delta` | LLM token | `{ delta: string }` |
| `response.text.done` | LLM complete | `{ text: string }` |
| `response.audio.delta` | TTS PCM chunk | Binary frame: raw PCM bytes (no JSON wrapper) |
| `response.audio.done` | TTS complete | `{}` |
| `voice-agent.tool_call` | Client tool request | `{ tool_call_id: string, name: string, arguments: any }` |
| `voice-agent.stt_result` | Final transcript + quality signals | `{ text: string, noSpeechProb: number, avgLogprob: number, durationMs: number }` |
| `voice-agent.status` | Pipeline status | `{ status: 'listening' \| 'processing' \| 'speaking' }` |
| `voice-agent.error` | Error | `{ code: string, message: string }` |
| `voice-agent.timings` | Pipeline timing instrumentation | `{ sttMs, llmFirstTokenMs, llmTotalMs, ttsFirstChunkMs, ... }` |

### Client Tool Flow

```
Server → voice-agent.tool_call { name: "fillFormFields", arguments: {...} }
Client → (executes tool, updates UI)
Client → voice-agent.tool_result { tool_call_id: "...", result: {...} }
Server → (feeds result to LLM, continues generating)
```

Max 25 tool call rounds per turn (same guard as current implementation).

## Server Package Changes (`packages/server`)

### Public API

Single export replaces `createVoiceRoutes`:

```typescript
// @unctad-ai/voice-agent-server
export function attachVoicePipeline(server: http.Server, options: VoiceServerOptions): void;
```

`VoiceServerOptions` is the same interface used by the current `createVoiceRoutes` (contains `config: SiteConfig`, `groqApiKey`, `ttsProvider`, provider URLs, etc.). No new options type needed.

### New Internal Files

| File | Purpose |
|------|---------|
| `createVoiceWebSocketHandler.ts` | WebSocket upgrade handler, session management, event routing |
| `voicePipeline.ts` | Orchestrates STT→LLM→TTS per turn, manages abort/barge-in |
| `sttStreamClient.ts` | WebSocket client to Python STT service |
| `ttsProviders.ts` | Extracted TTS provider functions (shared, same HTTP streaming logic) |
| `textUtils.ts` | Extracted `sanitizeForTTS`, `stripChainOfThought` |
| `protocol.ts` | Event type definitions, serialization helpers |

### Removed Exports

- `createVoiceRoutes` — replaced by `attachVoicePipeline`
- `createSttHandler` — replaced by `sttStreamClient.ts`
- `createTtsHandler` — TTS calls move into `voicePipeline.ts`
- `createChatHandler` — LLM calls move into `voicePipeline.ts`
- Individual handler option types (`ChatHandlerOptions`, `SttHandlerOptions`, `TtsHandlerOptions`)

Retained exports: `buildSystemPrompt`, `createBuiltinTools`, `buildSynonymMap`, `fuzzySearch`, `createPersonaRoutes`, `VoiceServerOptions`.

### Pipeline Lifecycle

Each user turn creates an `AbortController`. Barge-in (`response.cancel`) aborts the controller, cancelling LLM fetch and TTS fetch. STT WebSocket connection persists across turns (session-scoped). TTS and LLM are per-turn.

### Stateless Design

Server holds conversation history in memory only for the duration of the WebSocket connection. Client sends full history on `session.update` at connect/reconnect time. No external session store.

## Python STT Streaming Upgrade (`gpu-services/kyutai-stt`)

### New Endpoint

`WebSocket /ws/transcribe` — accepts PCM chunks, emits partial transcripts and VAD scores in real-time.

### Protocol (JSON over WebSocket)

Client → STT:
```json
{"type": "audio", "pcm": [0.012, -0.003, ...]}
{"type": "flush"}
{"type": "reset"}
```

STT → Client:
```json
{"type": "word", "text": "hello", "token_id": 42}
{"type": "vad", "probs": [0.12, 0.34, 0.67]}
{"type": "done", "text": "hello world", "vadProbs": [0.12, 0.34, 0.67]}
```

### Batched Inference

`batch_size=N` (default 4, configurable via `STT_BATCH_SIZE` env var). Each WebSocket connection gets a batch slot. A background asyncio task ticks at 12.5Hz (80ms per Mimi frame):

1. Collects latest PCM frame from each active connection's buffer (or zeros if no audio)
2. Stacks into batch tensor `[N, 1, 1920]`
3. Runs `mimi.encode()` → `lm_gen.step_with_extra_heads()` on the batch
4. Dispatches per-slot results to each WebSocket

All slots full → new connections get 503.

### Backward Compatibility

Existing `POST /v1/audio/transcriptions` stays functional for debugging. Not removed.

### GPU Resource Budget (RTX 4000 SFF Ada, 20GB)

| Service | Current VRAM | After Change |
|---------|-------------|-------------|
| Kyutai STT (batch_size=1) | 2.9 GB | — |
| Kyutai STT (batch_size=4) | — | ~6-8 GB (estimated) |
| Qwen3-TTS | 4.4 GB | 4.4 GB (unchanged) |
| **Total** | 7.4 GB | ~10-12 GB |
| **Free** | 12.7 GB | ~8-10 GB |

## Client Changes (`packages/core`)

### New Files

| File | Purpose |
|------|---------|
| `hooks/useVoiceWebSocket.ts` | Main hook — WebSocket connection, event handling, pipeline orchestration |
| `services/voiceWebSocket.ts` | WebSocket connection manager (connect, reconnect, event dispatch) |
| `protocol/events.ts` | TypeScript types for all WebSocket events (shared with server) |

### Removed Files

| File | Reason | Migration |
|------|--------|-----------|
| `services/voiceApi.ts` | HTTP wrappers no longer needed | `checkLLMHealth` moves into `voiceWebSocket.ts` as a WebSocket ping/pong health check. Exported from `core/index.ts` as `checkPipelineHealth`. |
| `utils/audioUtils.ts` | WAV encoding no longer needed | `float32ToWav` removed from public API. This is a breaking change — consuming projects that import it directly must remove the import. |

### Removed Peer Dependency

`@ai-sdk/react` is removed from `packages/core/package.json` peer dependencies. The `useChat` hook is no longer used. Consuming projects can remove `@ai-sdk/react` from their dependencies.

### Public API Removals (core package)

These exports are removed from `packages/core/src/index.ts`:
- `float32ToWav` (from `audioUtils.ts`)
- `parseWavHeader`, `pcmToFloat32`, `WavHeader` (from `wavParser.ts`) — no longer needed; audio is raw PCM
- `transcribeAudio`, `streamSpeech`, `synthesizeSpeech`, `checkLLMHealth` (from `voiceApi.ts`) — all replaced by WebSocket events

New export added:
- `checkPipelineHealth` — sends a WebSocket ping, returns `{ stt: boolean, llm: boolean, tts: boolean }`

### Modified Files

| File | Change |
|------|--------|
| `hooks/useVoiceAgent.ts` | Reimplemented using `useVoiceWebSocket`. Same external API preserved. |
| `hooks/useTenVAD.ts` | Added `onRawAudio(pcm)` callback — fires every 16ms with 256 samples at 16kHz. `useVoiceWebSocket` buffers 5 VAD hops (~80ms, 1280 samples at 16kHz), resamples to 24kHz (1920 samples) via `OfflineAudioContext`, then sends as one Mimi-compatible frame. |
| `hooks/useAudioPlayback.ts` | Accepts PCM chunks from WebSocket events instead of HTTP streaming response |

### Public API Preserved

`useVoiceAgent` return type unchanged: `{ status, messages, toggleMic, stopAudio, settings, ... }`. All `packages/ui` components (`GlassCopilotPanel`, `VoiceOrb`, etc.) require zero changes.

### Message State

`useVoiceWebSocket` maintains a local `messages[]` array, updated by `conversation.item.created` and `response.text.delta` events. Exposed as the same `Message[]` type the UI expects. Replaces `useChat`'s message management.

### Reconnection

Exponential backoff: 1s, 2s, 4s, max 30s. On reconnect, sends `session.update` with current conversation history. No turns lost.

### Barge-In (unchanged externally)

1. TEN VAD detects speech during `AI_SPEAKING` state
2. Client sends `response.cancel` over WebSocket
3. Client suspends AudioContext
4. Server aborts LLM + TTS, stops sending audio events
5. Client starts streaming new mic PCM frames

## Migration for Consuming Projects

### Server Setup Change

```typescript
// Before (createVoiceRoutes returns individual route handlers)
const routes = createVoiceRoutes({ config: siteConfig, groqApiKey, ttsProvider, ... });
app.use('/api/stt', routes.stt);
app.use('/api/tts', routes.tts);
app.post('/api/chat', routes.chat);
if (routes.persona) app.use('/api/agent', routes.persona);
const server = app.listen(3001);

// After (single call, same options object)
const server = app.listen(3001);
attachVoicePipeline(server, { config: siteConfig, groqApiKey, ttsProvider, ... });
```

### Environment Variable Change

`KYUTAI_STT_URL` changes from `http://host:8003` to `ws://host:8003/ws/transcribe`.

### What Does NOT Change

- `.voice-agent.yml` config format
- `voice-config.ts` (system prompts, extra server tools, service catalogs)
- Form field hooks (`useProgressiveFields`, `useRegisterUIAction`)
- UI components (all of `packages/ui`)
- TTS GPU services (same HTTP endpoints)
- Groq API usage
- Persona assets / voice cloning setup

### Rollout

`voice-agent-action` rebuilds all consuming projects on every kit release. All projects use `latest`. One kit release updates all deployments simultaneously.

## What Stays the Same

- TEN VAD client-side for fast barge-in detection
- All 5 TTS providers (qwen3, chatterbox, cosyvoice, pocket, resemble) with fallback chains
- Text sanitization (`sanitizeForTTS`, `stripChainOfThought`)
- STT hallucination filtering (`noSpeechProb`, `avgLogprob`, blacklist)
- Pipeline timing instrumentation
- Groq LLM via HTTP (Groq SDK)
- `data-testid` attributes on UI components

## Latency Projection

| Stage | Current | After |
|-------|---------|-------|
| VAD capture | ~500ms | ~500ms (unchanged) |
| WAV encode + upload | ~200ms | 0ms (streaming, no encode) |
| STT | ~1-2s (batch) | ~0.5-1s (streaming, overlaps with speech) |
| LLM first token | ~1-3s | ~1-2s (no HTTP round-trip, server-initiated) |
| TTS TTFA | ~200ms | ~200ms (unchanged) |
| **Total to first audio** | **~3-6s** | **~1.5-3s** |

Primary savings: eliminate WAV encode/upload (200ms), overlap STT with speech (500ms-1s), eliminate client→server HTTP round-trip for LLM (200-500ms).

## Known Limitations & Future Work

### WebSocket in government/corporate networks
WebSocket requires HTTP Upgrade, which some corporate proxies strip. The current SSE pipeline works over plain HTTP. For UN/government deployments where WebSocket may be blocked:
- `voice-agent-action` build should validate WebSocket connectivity during deploy healthcheck
- Document diagnostic path: if WebSocket fails to connect, server logs should surface `Upgrade header missing` or `403 from proxy` with actionable guidance (proxy allowlisting, CONNECT tunnel)
- If field use expands to environments where WebSocket is consistently blocked, revisit the SSE fallback decision

### PCM bandwidth on mobile
At ~192 KB/s bidirectional, a 5-second turn is ~1 MB. Fine for office-based government users on 3G+. If field use expands to 2G environments, revisit Opus encoding decision.

## Error Handling & Edge Cases

### Browser ↔ Express WebSocket drops
- Client reconnects with exponential backoff (1s, 2s, 4s, max 30s)
- On reconnect, client sends `session.update` with full conversation history
- If a turn was in-flight when the connection dropped, inject a synthetic assistant message: "Sorry, I missed that — could you repeat?" This makes the copilot feel conversational rather than showing a cold "Connection restored" banner.
- If reconnect fails 5 times, client falls back to a "connection lost" UI state

### Express ↔ STT WebSocket drops
- `sttStreamClient` reconnects automatically with backoff
- If STT is down for >10s, server sends `voice-agent.error { code: "stt_unavailable" }`
- Client shows "Voice temporarily unavailable" and disables mic
- Server retries STT connection in background; sends `voice-agent.status { status: "listening" }` when restored

### STT batch slot exhaustion
- New WebSocket connections to STT get 503 when all slots are full
- Express sends `voice-agent.error { code: "stt_capacity" }` to client
- Client shows "Service busy, please wait" — retries after 5s

### GPU OOM during batch inference
- STT server catches CUDA OOM, logs error, reduces batch_size by 1, resets LMGen
- Active connections on the dropped slot get `voice-agent.error { code: "stt_error" }`
- Server automatically recovers at lower batch_size

### Malformed PCM / wrong sample rate
- Server validates frame size (must be 1920 samples for 24kHz, or proportional for other rates)
- Invalid frames are silently dropped (zero-padded in the batch)
- If >50% of frames in a turn are invalid, server sends `voice-agent.error { code: "bad_audio" }`

### LLM timeout / Groq error
- `voicePipeline` has per-turn timeout (20s default, configurable)
- On timeout or Groq error, server sends `voice-agent.error { code: "llm_error", message: "..." }`
- Client shows error state, allows user to retry

### TTS failure with fallback
- Same fallback chain as today (qwen3 → pocket → resemble)
- Fallback happens transparently server-side
- If all providers fail, server sends `response.text.done` (transcript displayed) + `voice-agent.error { code: "tts_unavailable" }` — user sees the text response but hears nothing

### Binary vs JSON frame disambiguation
- WebSocket messages are either binary (PCM audio) or text (JSON events)
- `ws` package distinguishes these natively via `message` event's `isBinary` flag
- Binary frames from client = `input_audio_buffer.append`
- Binary frames from server = `response.audio.delta`
- All other events are JSON text frames with `{ type: "event.name", ... }` structure
