---
"@unctad-ai/voice-agent-registries": patch
---

fix(registries): warn LLM when getServiceDetails returns sparse data

When service data only has basic fields (title, category), the handler now appends a _note telling the LLM not to claim details like duration or cost are absent. Prevents hallucination when consuming projects haven't populated rich service data.
