---
"@unctad-ai/voice-agent-core": minor
"@unctad-ai/voice-agent-server": minor
"@unctad-ai/voice-agent-ui": minor
---

Theming, UX, and tone improvements

- Wire up SiteColors orb states (processing, speaking, glow, error) with derived gradients
- Add `fontFamily` to SiteConfig for CSS cascade font inheritance
- Replace Tailwind classes with inline styles in settings components for consuming app compatibility
- Auto-scroll with new-message pill when user scrolls up
- Conversational system prompt tone — no tool narration
- Defensive hex parsing and memoized orb state configs
