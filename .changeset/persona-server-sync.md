---
'@unctad-ai/voice-agent-server': patch
'@unctad-ai/voice-agent-core': patch
---

Server-side system prompt now respects persona overrides (copilotName, systemPromptIntro, etc.) set via the admin settings UI. Also adds {name} and {siteTitle} variable support in greetingMessage and farewellMessage.
