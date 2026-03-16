---
"@unctad-ai/voice-agent-server": patch
---

fix(server): buffer STT done result to prevent race condition where flush completes before pipeline sets up the listener
