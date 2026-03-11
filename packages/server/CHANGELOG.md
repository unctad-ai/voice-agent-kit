# @unctad-ai/voice-agent-server

## 1.0.2

### Patch Changes

- Updated dependencies [6fe4674]
  - @unctad-ai/voice-agent-core@1.0.2

## 1.0.1

### Patch Changes

- 720109d: fix: avatar data URI inlining, TTS fallback opt-in, remove Whisper STT fallback, empty state wiring
- Updated dependencies [720109d]
  - @unctad-ai/voice-agent-core@1.0.1

## 1.0.0

### Minor Changes

- 2221a03: Theming, UX, and tone improvements

  - Wire up SiteColors orb states (processing, speaking, glow, error) with derived gradients
  - Add `fontFamily` to SiteConfig for CSS cascade font inheritance
  - Replace Tailwind classes with inline styles in settings components for consuming app compatibility
  - Auto-scroll with new-message pill when user scrolls up
  - Conversational system prompt tone — no tool narration
  - Defensive hex parsing and memoized orb state configs

### Patch Changes

- Updated dependencies [2221a03]
  - @unctad-ai/voice-agent-core@1.0.0

## 0.1.8

### Patch Changes

- Updated dependencies [6fe2cc7]
  - @unctad-ai/voice-agent-core@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [a1731a6]
  - @unctad-ai/voice-agent-core@0.1.7

## 0.1.6

### Patch Changes

- @unctad-ai/voice-agent-core@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [4e4c7f2]
  - @unctad-ai/voice-agent-core@0.1.5

## 0.1.4

### Patch Changes

- 4d49081: Strengthen system prompt: agent must call getFormSchema after every fillFormFields and never declare a form complete without verifying no unfilled fields remain.
  - @unctad-ai/voice-agent-core@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [9b512d0]
  - @unctad-ai/voice-agent-core@0.1.3

## 0.1.2

### Patch Changes

- @unctad-ai/voice-agent-core@0.1.2

## 0.1.1

### Patch Changes

- 8d0c534: Initial release of voice-agent-kit packages
- Updated dependencies [8d0c534]
  - @unctad-ai/voice-agent-core@0.1.1
