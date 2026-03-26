# @unctad-ai/voice-agent-server

## 5.4.2

### Patch Changes

- Updated dependencies [9c091e0]
  - @unctad-ai/voice-agent-core@5.4.2

## 5.4.1

### Patch Changes

- Updated dependencies [693ad5c]
  - @unctad-ai/voice-agent-core@5.4.1

## 5.4.0

### Patch Changes

- @unctad-ai/voice-agent-core@5.4.0

## 5.3.1

### Patch Changes

- Updated dependencies [de06870]
  - @unctad-ai/voice-agent-core@5.3.1

## 5.3.0

### Patch Changes

- Updated dependencies [e499ac9]
  - @unctad-ai/voice-agent-core@5.3.0

## 5.2.6

### Patch Changes

- Updated dependencies [b52dad5]
  - @unctad-ai/voice-agent-core@5.2.6

## 5.2.5

### Patch Changes

- @unctad-ai/voice-agent-core@5.2.5

## 5.2.4

### Patch Changes

- @unctad-ai/voice-agent-core@5.2.4

## 5.2.3

### Patch Changes

- Updated dependencies [a793f8c]
  - @unctad-ai/voice-agent-core@5.2.3

## 5.2.2

### Patch Changes

- Updated dependencies [a919830]
  - @unctad-ai/voice-agent-core@5.2.2

## 5.2.1

### Patch Changes

- @unctad-ai/voice-agent-core@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [2cdf9f9]
  - @unctad-ai/voice-agent-core@5.2.0

## 5.1.3

### Patch Changes

- Updated dependencies [ffe5163]
  - @unctad-ai/voice-agent-core@5.1.3

## 5.1.2

### Patch Changes

- 02b3654: Feedback v2: persistent ticket IDs, collision guard, improved copy UX
  - @unctad-ai/voice-agent-core@5.1.2

## 5.1.1

### Patch Changes

- @unctad-ai/voice-agent-core@5.1.1

## 5.1.0

### Minor Changes

- 369ca7d: Conversation feedback and session trace retrieval

  - feat(server): POST/GET `/api/feedback` for reporting bad assistant responses
  - feat(server): GET `/api/traces` and `/api/traces/:sessionId` for session trace retrieval
  - feat(server): session logger buffers structured trace entries, flushes to disk on session close
  - feat(core): expose `sessionId` from `session.created` WebSocket event
  - feat(ui): feedback pill on assistant messages with "Feedback" label on hover
  - feat(ui): amber feedback composer mode with positive "How could this be better?" placeholder
  - feat(ui): deduplicate consecutive assistant name labels in transcript

### Patch Changes

- Updated dependencies [369ca7d]
  - @unctad-ai/voice-agent-core@5.1.0

## 5.0.6

### Patch Changes

- 5319369: TTS graceful degradation: detect missing TTS URL at startup, signal via session.created and health check, skip TTS in pipeline, client shows muted avatar.
  - @unctad-ai/voice-agent-core@5.0.6

## 5.0.5

### Patch Changes

- 12bead1: CI: use Coolify force deploy (without cache) for auto-redeployment after npm publish.
  - @unctad-ai/voice-agent-core@5.0.5

## 5.0.4

### Patch Changes

- 6a61f6e: CI pipeline: auto-redeploy Coolify apps with force_rebuild after npm publish, with 30s delay for CDN propagation.
  - @unctad-ai/voice-agent-core@5.0.4

## 5.0.3

### Patch Changes

- 80c1137: CI auto-redeploys all Coolify voice-agent apps after npm publish.
  - @unctad-ai/voice-agent-core@5.0.3

## 5.0.2

### Patch Changes

- d61766c: Fix paramsJson type coercion for Qwen3 (object→string via z.preprocess) and add prompt rule to execute confirmed actions immediately without re-asking.
  - @unctad-ai/voice-agent-core@5.0.2

## 5.0.1

### Patch Changes

- b0659f2: Offline UX improvements: gray FAB ring when backend offline, disabled text input with "Reconnecting..." placeholder, auto-retry with exponential backoff and countdown. Text input auto-focuses on keyboard switch and stays in text mode after submit. Default TTS provider changed to luxtts.
  - @unctad-ai/voice-agent-core@5.0.1

## 5.0.0

### Major Changes

- f36961b: Voice agent v4.0.0 — Qwen3 compliance, TTS fixes, shared settings, form intelligence

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

### Patch Changes

- Updated dependencies [f36961b]
  - @unctad-ai/voice-agent-core@5.0.0

## 4.0.0

### Minor Changes

- cc8efdb: Voice agent v3.1.0 — Qwen3 compliance, TTS fixes, shared settings, form intelligence

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

### Patch Changes

- Updated dependencies [cc8efdb]
  - @unctad-ai/voice-agent-core@4.0.0

## 3.0.3

### Patch Changes

- a3658e7: Pipeline reliability fixes:
  - Fix tool calling (strip execute, use SDK toolCalls API, correct ModelMessage schema)
  - Switch default LLM to qwen/qwen3-32b (3.8x faster)
  - Wire PCM playback lifecycle to complete AI_SPEAKING transition
  - Make getServiceDetails a client tool for richer data
  - Fix client tool whitelist, per-round LLM timeout
  - Add turn tracing, TTS 503 retry, graceful degradation
  - Improve system prompt for STT errors and tool guidance
- Updated dependencies [a3658e7]
  - @unctad-ai/voice-agent-core@3.0.3

## 3.0.2

### Patch Changes

- e38eaac: Pipeline hardening fixes: streaming TTS with temperature passthrough, SILENT UX cleanup, browser AGC instead of server gain normalization, version logging
- Updated dependencies [e38eaac]
  - @unctad-ai/voice-agent-core@3.0.2

## 3.0.1

### Patch Changes

- 7411f1c: Fix STT transcription quality: normalize audio gain before forwarding to STT, fix buffer alignment crash, add pipeline observability logs
  - @unctad-ai/voice-agent-core@3.0.1

## 3.0.0

### Minor Changes

- 4663240: WebSocket pipeline hardening: state machines, async queue, turn boundaries, echo guard, audio buffering, error propagation

### Patch Changes

- Updated dependencies [4663240]
  - @unctad-ai/voice-agent-core@3.0.0

## 2.0.5

### Patch Changes

- e82ede4: fix: cancel previous turn before starting new one to prevent racing startTurn calls
  - @unctad-ai/voice-agent-core@2.0.5

## 2.0.4

### Patch Changes

- Updated dependencies [4908b38]
  - @unctad-ai/voice-agent-core@2.0.4

## 2.0.3

### Patch Changes

- 87eacb3: fix: guard sendAudio against null WebSocket, add debug logging to WebSocket handler
- Updated dependencies [87eacb3]
  - @unctad-ai/voice-agent-core@2.0.3

## 2.0.2

### Patch Changes

- f45346f: debug: add message logging to WebSocket handler for integration debugging
  - @unctad-ai/voice-agent-core@2.0.2

## 2.0.1

### Patch Changes

- e1ee6ee: fix(server): buffer STT done result to prevent race condition where flush completes before pipeline sets up the listener
  - @unctad-ai/voice-agent-core@2.0.1

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

## 1.0.10

### Patch Changes

- 47d357b: Remove auto end-session to prevent false-positive goodbyes
- Updated dependencies [47d357b]
  - @unctad-ai/voice-agent-core@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [fac530f]
  - @unctad-ai/voice-agent-core@1.0.9

## 1.0.8

### Patch Changes

- 6daf0ae: Add language hint to STT pipeline — configurable per project via SiteConfig.language and per user via Settings UI. Fixes wrong-language transcription hallucinations. Also adds greetingMessage to SiteConfig.
- Updated dependencies [6daf0ae]
  - @unctad-ai/voice-agent-core@1.0.8

## 1.0.7

### Patch Changes

- @unctad-ai/voice-agent-core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [5e28fc3]
  - @unctad-ai/voice-agent-core@1.0.6

## 1.0.5

### Patch Changes

- @unctad-ai/voice-agent-core@1.0.5

## 1.0.4

### Patch Changes

- cf712a1: fix: move groq-sdk to dependencies (was only in devDependencies)
  - @unctad-ai/voice-agent-core@1.0.4

## 1.0.3

### Patch Changes

- 9506d2f: Bump groq-sdk to v1.1.1 and zod to v4.3.6
- Updated dependencies [9506d2f]
  - @unctad-ai/voice-agent-core@1.0.3

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
