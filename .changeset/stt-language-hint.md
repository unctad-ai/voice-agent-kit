---
"@unctad-ai/voice-agent-core": patch
"@unctad-ai/voice-agent-ui": patch
"@unctad-ai/voice-agent-server": patch
---

Add language hint to STT pipeline — configurable per project via SiteConfig.language and per user via Settings UI. Fixes wrong-language transcription hallucinations. Also adds greetingMessage to SiteConfig.
