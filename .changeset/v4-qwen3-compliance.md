---
"@unctad-ai/voice-agent-core": major
"@unctad-ai/voice-agent-registries": major
"@unctad-ai/voice-agent-server": major
"@unctad-ai/voice-agent-ui": major
---

Voice agent v4.0.0 — Qwen3 compliance, TTS fixes, shared settings, form intelligence

**Breaking changes:**
- Silent marker: `[SILENT]` → `<silent/>` — aligns with Qwen3 XML training (A/B: 9/10 vs 0/3)
- VoicePipelineOptions: `sessionId` replaced with `logger` (SessionLogger)
- LLM temperature: 0.3 → 0.1
- System prompt reorganized as decision cascade
- startApplication no longer emits `<internal>` override

### core
- Wire clientState from client to server (route, forms, UI actions, current service)
- Debounce reactive clientState session.update (300ms)
- Silent marker: `<silent/>` XML tag
- Recover from STT errors and WS disconnects
- Add summarizeToolResult utility
- Shared settings: extend PersonaApi, usePersona hook

### registries
- Gated sections: placeholders in getFormSchema, ready gate for Add-before-fill
- All-filled hint for multi-tab navigation
- `<internal>` XML tags replace `[INTERNAL:]`
- Remove startApplication `<internal>` that overrode FORMS rules

### server
- System prompt: decision cascade (SILENT→SPEECH→RULES→TONE→TOOLS→FORMS→GOODBYE)
- System prompt: FORMS consolidated 9 → 7 rules, BAD/GOOD examples
- TTS: em/en dashes → commas for pauses, ellipsis preserved
- Auto-refresh getFormSchema after fillFormFields and performUIAction
- Session-scoped logger (SessionLogger)
- LuxTTS and vLLM-Omni TTS providers
- Upload field type awareness
- Shared settings: admin auth, broadcast, /config endpoint
- Eval scripts: test-llm-compliance.py, test-pipeline.mjs

### ui
- Shared settings panel with admin controls
- Preserve conversation on mic toggle
- Handle avatar upload errors, lower barge-in sensitivity
