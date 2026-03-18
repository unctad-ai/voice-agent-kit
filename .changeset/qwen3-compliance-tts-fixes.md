---
"@unctad-ai/voice-agent-core": minor
"@unctad-ai/voice-agent-registries": minor
"@unctad-ai/voice-agent-server": minor
"@unctad-ai/voice-agent-ui": minor
---

System prompt redesign for Qwen3 compliance and TTS fixes

**Breaking behavioral changes:**
- Silent marker changed from `[SILENT]` to `<silent/>` — consuming projects using `SILENT_MARKER` from `@unctad-ai/voice-agent-core` get this automatically
- LLM temperature lowered from 0.3 to 0.1 for better rule compliance

**System prompt:**
- Reorganized as decision cascade: SILENT → SPEECH → RULES → TONE → TOOLS → FORMS → GOODBYE
- FORMS consolidated from 9 overfit rules to 7 general rules
- Added BAD/GOOD response examples for brevity guidance
- "BEFORE RESPONDING, ask yourself" guides Qwen3 thinking step for silence detection
- Merged 4 tool sections (TOOL RESULTS, TOOL SELECTION, PROACTIVE NAVIGATION, CONTEXT AWARENESS) into one TOOLS section

**TTS:**
- Em/en dashes now convert to commas (TTS pause) instead of hyphens (no pause)
- Ellipsis (...) preserved as TTS hesitation marker instead of collapsed to period

**Infrastructure:**
- Session-scoped logger replaces raw console.log throughout server package
- Removed startApplication `<internal>` tag that was overriding FORMS rules
- Added `scripts/test-llm-compliance.py` — 13-scenario eval importing live system prompt
