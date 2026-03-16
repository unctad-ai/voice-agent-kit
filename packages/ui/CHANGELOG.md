# @unctad-ai/voice-agent-ui

## 2.0.0

### Major Changes

- 461843c: Replace HTTP REST voice pipeline with WebSocket.

  - Single persistent WebSocket connection at /api/voice
  - Server-side STT→LLM→TTS orchestration (no client round-trips for LLM)
  - Streaming STT via upgraded Python Kyutai server
  - Binary PCM audio frames (no WAV encoding overhead)
  - Batched STT inference (up to 4 concurrent users)
  - New API: attachVoicePipeline(server, options) replaces createVoiceRoutes
  - Removed: createSttHandler, createTtsHandler, createChatHandler, voiceApi HTTP wrappers
  - Removed: @ai-sdk/react peer dependency

  BREAKING CHANGE: REST endpoints /api/stt, /api/tts, /api/chat removed.
  Consuming projects must use attachVoicePipeline() instead.

### Patch Changes

- Updated dependencies [461843c]
  - @unctad-ai/voice-agent-core@2.0.0
  - @unctad-ai/voice-agent-registries@2.0.0

## 1.0.10

### Patch Changes

- 47d357b: Remove auto end-session to prevent false-positive goodbyes
- Updated dependencies [47d357b]
  - @unctad-ai/voice-agent-core@1.0.10
  - @unctad-ai/voice-agent-registries@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [fac530f]
  - @unctad-ai/voice-agent-core@1.0.9
  - @unctad-ai/voice-agent-registries@1.0.9

## 1.0.8

### Patch Changes

- 6daf0ae: Add language hint to STT pipeline — configurable per project via SiteConfig.language and per user via Settings UI. Fixes wrong-language transcription hallucinations. Also adds greetingMessage to SiteConfig.
- Updated dependencies [6daf0ae]
  - @unctad-ai/voice-agent-core@1.0.8
  - @unctad-ai/voice-agent-registries@1.0.8

## 1.0.7

### Patch Changes

- 3ddf6fe: Show kit version in the Developer settings panel
  - @unctad-ai/voice-agent-core@1.0.7
  - @unctad-ai/voice-agent-registries@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [5e28fc3]
  - @unctad-ai/voice-agent-core@1.0.6
  - @unctad-ai/voice-agent-registries@1.0.6

## 1.0.5

### Patch Changes

- 17ab71e: fix(ui): support uncontrolled mode in GlassCopilotPanel

  GlassCopilotPanel now manages its own open/close state when `isOpen`/`onOpen`/`onClose` props are omitted. This fixes deployments where the scaffold renders `<GlassCopilotPanel />` without state props — the FAB was visible but clicking it did nothing.

  - @unctad-ai/voice-agent-core@1.0.5
  - @unctad-ai/voice-agent-registries@1.0.5

## 1.0.4

### Patch Changes

- @unctad-ai/voice-agent-core@1.0.4
- @unctad-ai/voice-agent-registries@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [9506d2f]
  - @unctad-ai/voice-agent-core@1.0.3
  - @unctad-ai/voice-agent-registries@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [6fe4674]
  - @unctad-ai/voice-agent-core@1.0.2
  - @unctad-ai/voice-agent-registries@1.0.2

## 1.0.1

### Patch Changes

- 720109d: fix: avatar data URI inlining, TTS fallback opt-in, remove Whisper STT fallback, empty state wiring
- Updated dependencies [720109d]
  - @unctad-ai/voice-agent-core@1.0.1
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

- Updated dependencies [2221a03]
  - @unctad-ai/voice-agent-core@1.0.0
  - @unctad-ai/voice-agent-registries@1.0.0

## 0.1.8

### Patch Changes

- Updated dependencies [6fe2cc7]
  - @unctad-ai/voice-agent-core@0.1.8
  - @unctad-ai/voice-agent-registries@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [a1731a6]
  - @unctad-ai/voice-agent-core@0.1.7
  - @unctad-ai/voice-agent-registries@0.1.7

## 0.1.6

### Patch Changes

- ec49451: Add data-testid attributes to GlassCopilotPanel components for browser automation testing
  - @unctad-ai/voice-agent-core@0.1.6
  - @unctad-ai/voice-agent-registries@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [4e4c7f2]
  - @unctad-ai/voice-agent-core@0.1.5
  - @unctad-ai/voice-agent-registries@0.1.5

## 0.1.4

### Patch Changes

- @unctad-ai/voice-agent-core@0.1.4
- @unctad-ai/voice-agent-registries@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [9b512d0]
  - @unctad-ai/voice-agent-core@0.1.3
  - @unctad-ai/voice-agent-registries@0.1.3

## 0.1.2

### Patch Changes

- f02994e: Switch UI package to tsup bundler and inject CSS at runtime instead of requiring separate CSS imports
  - @unctad-ai/voice-agent-core@0.1.2
  - @unctad-ai/voice-agent-registries@0.1.2

## 0.1.1

### Patch Changes

- 8d0c534: Initial release of voice-agent-kit packages
- Updated dependencies [8d0c534]
  - @unctad-ai/voice-agent-core@0.1.1
  - @unctad-ai/voice-agent-registries@0.1.1
