---
"@unctad-ai/voice-agent-server": patch
---

TTS graceful degradation: detect missing TTS URL at startup, signal via session.created and health check, skip TTS in pipeline, client shows muted avatar.
