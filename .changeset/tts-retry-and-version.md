---
"@unctad-ai/voice-agent-core": patch
"@unctad-ai/voice-agent-server": patch
"@unctad-ai/voice-agent-registries": patch
"@unctad-ai/voice-agent-ui": patch
---

Pipeline reliability fixes:
- Fix tool calling (strip execute, use SDK toolCalls API, correct ModelMessage schema)
- Switch default LLM to qwen/qwen3-32b (3.8x faster)
- Wire PCM playback lifecycle to complete AI_SPEAKING transition
- Make getServiceDetails a client tool for richer data
- Fix client tool whitelist, per-round LLM timeout
- Add turn tracing, TTS 503 retry, graceful degradation
- Improve system prompt for STT errors and tool guidance
