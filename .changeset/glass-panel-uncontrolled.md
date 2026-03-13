---
"@unctad-ai/voice-agent-ui": patch
---

fix(ui): support uncontrolled mode in GlassCopilotPanel

GlassCopilotPanel now manages its own open/close state when `isOpen`/`onOpen`/`onClose` props are omitted. This fixes deployments where the scaffold renders `<GlassCopilotPanel />` without state props — the FAB was visible but clicking it did nothing.
