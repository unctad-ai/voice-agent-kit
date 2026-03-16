---
"@unctad-ai/voice-agent-server": patch
---

fix: cancel previous turn before starting new one to prevent racing startTurn calls
