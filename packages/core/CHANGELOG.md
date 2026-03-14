# @unctad-ai/voice-agent-core

## 1.0.10

### Patch Changes

- 47d357b: Remove auto end-session to prevent false-positive goodbyes
  - @unctad-ai/voice-agent-registries@1.0.10

## 1.0.9

### Patch Changes

- fac530f: Suppress persona 404 gracefully: when persona routes are not mounted, fall back to static config silently instead of logging a warning
  - @unctad-ai/voice-agent-registries@1.0.9

## 1.0.8

### Patch Changes

- 6daf0ae: Add language hint to STT pipeline — configurable per project via SiteConfig.language and per user via Settings UI. Fixes wrong-language transcription hallucinations. Also adds greetingMessage to SiteConfig.
  - @unctad-ai/voice-agent-registries@1.0.8

## 1.0.7

### Patch Changes

- @unctad-ai/voice-agent-registries@1.0.7

## 1.0.6

### Patch Changes

- 5e28fc3: Default personaEndpoint to /api/agent so persona settings (avatar, voice cloning) are always visible
  - @unctad-ai/voice-agent-registries@1.0.6

## 1.0.5

### Patch Changes

- @unctad-ai/voice-agent-registries@1.0.5

## 1.0.4

### Patch Changes

- @unctad-ai/voice-agent-registries@1.0.4

## 1.0.3

### Patch Changes

- 9506d2f: Bump groq-sdk to v1.1.1 and zod to v4.3.6
  - @unctad-ai/voice-agent-registries@1.0.3

## 1.0.2

### Patch Changes

- 6fe4674: Declare @gooney-001/ten-vad-lib and zod as peer dependencies of voice-agent-core, enabling the scaffold to auto-resolve all required deps from the npm registry.
  - @unctad-ai/voice-agent-registries@1.0.2

## 1.0.1

### Patch Changes

- 720109d: fix: avatar data URI inlining, TTS fallback opt-in, remove Whisper STT fallback, empty state wiring
  - @unctad-ai/voice-agent-registries@1.0.1

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

- @unctad-ai/voice-agent-registries@1.0.0

## 0.1.8

### Patch Changes

- 6fe2cc7: fix: use module-level Set for onToolCall replay guard to survive React remounts
  - @unctad-ai/voice-agent-registries@0.1.8

## 0.1.7

### Patch Changes

- a1731a6: Fix "Processing..." stall during multi-step form filling: prevent onToolCall replay for historical tool calls, auto-recover when SDK is idle but voice state is stuck, and improve performUIAction error messages to list available actions.
- Updated dependencies [a1731a6]
  - @unctad-ai/voice-agent-registries@0.1.7

## 0.1.6

### Patch Changes

- @unctad-ai/voice-agent-registries@0.1.6

## 0.1.5

### Patch Changes

- 4e4c7f2: Fix client tool round-trip counter that prevented multi-step form filling. The counter was double-incrementing (in both onToolCall and sendAutomaticallyWhen), exhausting the budget of 3 after just one fill cycle. Now counts only actual HTTP round-trips, raised limit to 25, and provides a graceful fallback instead of silently freezing.
  - @unctad-ai/voice-agent-registries@0.1.5

## 0.1.4

### Patch Changes

- @unctad-ai/voice-agent-registries@0.1.4

## 0.1.3

### Patch Changes

- 9b512d0: Fix multi-step client tool round-trips getting stuck on the same assistant message. The sendAutomaticallyWhen dedup key now includes resolved tool count so successive follow-ups (e.g. fillFormFields → getFormSchema) are not blocked.
  - @unctad-ai/voice-agent-registries@0.1.3

## 0.1.2

### Patch Changes

- @unctad-ai/voice-agent-registries@0.1.2

## 0.1.1

### Patch Changes

- 8d0c534: Initial release of voice-agent-kit packages
- Updated dependencies [8d0c534]
  - @unctad-ai/voice-agent-registries@0.1.1
