---
"@unctad-ai/voice-agent-core": major
"@unctad-ai/voice-agent-server": major
"@unctad-ai/voice-agent-registries": major
"@unctad-ai/voice-agent-ui": major
---

Replace HTTP REST voice pipeline with WebSocket.

- Single persistent WebSocket connection at /api/voice
- Server-side STT→LLM→TTS orchestration (no client round-trips for LLM)
- Streaming STT via upgraded Python Kyutai server
- Binary PCM audio frames (no WAV encoding overhead)
- Batched STT inference (up to 4 concurrent users)
- New API: attachVoicePipeline(server, options) replaces createVoiceRoutes
- Removed: createSttHandler, createTtsHandler, createChatHandler, voiceApi HTTP wrappers
- Removed: @ai-sdk/react peer dependency

BREAKING CHANGE: REST endpoints /api/stt, /api/tts, /api/chat removed.
Consuming projects must use attachVoicePipeline() instead.
