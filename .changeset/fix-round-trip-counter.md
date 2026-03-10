---
"@unctad-ai/voice-agent-core": patch
---

Fix client tool round-trip counter that prevented multi-step form filling. The counter was double-incrementing (in both onToolCall and sendAutomaticallyWhen), exhausting the budget of 3 after just one fill cycle. Now counts only actual HTTP round-trips, raised limit to 10, and provides a graceful fallback instead of silently freezing.
