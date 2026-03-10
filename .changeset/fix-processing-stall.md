---
"@unctad-ai/voice-agent-core": patch
"@unctad-ai/voice-agent-registries": patch
---

Fix "Processing..." stall during multi-step form filling: prevent onToolCall replay for historical tool calls, auto-recover when SDK is idle but voice state is stuck, and improve performUIAction error messages to list available actions.
