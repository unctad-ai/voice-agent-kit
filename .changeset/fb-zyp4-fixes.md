---
"@unctad-ai/voice-agent-registries": minor
"@unctad-ai/voice-agent-server": patch
---

fix(registries): extract service details from DOM when config lacks rich data

When `getServiceDetails` is called and `config.services` only has basic fields
(title, category), the handler now reads visible page content from the DOM —
extracting cost, duration, requirements, eligibility, process, and more.

fix(server): prevent LLM from exposing internal tool terminology to users

Added system prompt rule 6 with BAD/GOOD examples to stop the model from
mentioning "tools", "tool responses", or internal systems in user-facing speech.

Closes: FB-ZYP4
