---
"@unctad-ai/voice-agent-core": minor
"@unctad-ai/voice-agent-registries": minor
"@unctad-ai/voice-agent-server": minor
"@unctad-ai/voice-agent-ui": minor
---

Voice agent v3.1.0 — Qwen3 compliance, TTS fixes, shared settings, form intelligence

### core
- Wire clientState from client to server (route, forms, UI actions, current service)
- Debounce reactive clientState session.update (300ms)
- Guard against undefined registries in buildClientState
- Silent marker: `[SILENT]` → `<silent/>` for Qwen3 XML tag compliance (A/B: 9/10 vs 0/3)
- Recover from STT errors and WS disconnects
- Add summarizeToolResult utility
- Shared settings: extend PersonaApi, usePersona hook for runtime config

### registries
- Gated sections: placeholders in getFormSchema, ready gate for Add-before-fill pattern
- Deduplicate gated sections, guard fillFormFields against gated fields
- All-filled hint for multi-tab navigation
- Normalize bare-string options on register
- `<internal>` XML tags replace `[INTERNAL:]` for Qwen3 ChatML alignment
- Remove startApplication `<internal>` override that fought FORMS rules

### server
- System prompt: reorganized as decision cascade (SILENT→SPEECH→RULES→TONE→TOOLS→FORMS→GOODBYE)
- System prompt: FORMS consolidated from 9 to 7 rules, removed overfitting
- System prompt: added BAD/GOOD examples, thinking-step guidance for silence detection
- Silent marker: `<silent/>` XML tag throughout
- LLM temperature: 0.3 → 0.1 for better rule compliance
- TTS: em/en dashes → commas (TTS pause), ellipsis preserved
- Auto-refresh getFormSchema after fillFormFields and performUIAction
- Session-scoped logger replaces raw console.log
- LuxTTS and vLLM-Omni TTS providers added
- Upload field type for file upload awareness
- Shared settings: admin auth, broadcast, /config endpoint
- Added scripts/test-llm-compliance.py (13-scenario eval)
- Added scripts/test-pipeline.mjs (headless WebSocket eval)

### ui
- Shared settings panel with admin controls
- Preserve conversation on mic toggle
- Handle avatar upload errors, lower barge-in sensitivity
