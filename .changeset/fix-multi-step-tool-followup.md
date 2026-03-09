---
"@unctad-ai/voice-agent-core": patch
---

Fix multi-step client tool round-trips getting stuck on the same assistant message. The sendAutomaticallyWhen dedup key now includes resolved tool count so successive follow-ups (e.g. fillFormFields → getFormSchema) are not blocked.
