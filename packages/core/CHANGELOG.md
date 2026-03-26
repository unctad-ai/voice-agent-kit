# @unctad-ai/voice-agent-core

## 5.4.3

### Patch Changes

- 458aa31: fix(core): fix NaN in AudioWorklet resampler causing STT "not finite" errors

  When resamplePos landed exactly on (input.length - 1), the loop exited without
  processing and subtracting input.length produced -1. Next call: input[-1] is
  undefined → NaN propagated through the entire audio pipeline to STT.

  Reproduced: NaN occurs every ~3 process() calls with 48kHz→16kHz resampling.
  Fix: clamp carry position to 0. Verified with 10,000 iterations, zero NaN.

  - @unctad-ai/voice-agent-registries@5.4.3

## 5.4.2

### Patch Changes

- 9c091e0: fix(core): vendor TEN-VAD WASM module — removes @gooney-001/ten-vad-lib external dependency and eliminates the Vite alias requirement for consuming projects
  - @unctad-ai/voice-agent-registries@5.4.2

## 5.4.1

### Patch Changes

- 693ad5c: fix(core): resolve ten-vad WASM module via real package path instead of Vite alias

  Replaces `import('ten-vad-glue')` with `import('@gooney-001/ten-vad-lib/ten_vad.js')` and removes `@vite-ignore`. The bare specifier failed to resolve at runtime in production builds where Vite's esbuild pre-bundler doesn't apply aliases. Moves `@gooney-001/ten-vad-lib` from peerDependencies to dependencies so the kit owns its VAD dependency.

  - @unctad-ai/voice-agent-registries@5.4.1

## 5.4.0

### Patch Changes

- @unctad-ai/voice-agent-registries@5.4.0

## 5.3.1

### Patch Changes

- de06870: Message bubbles with tinting, empty state with suggested prompt chips, collapsed bar message preview. Fix text/voice race condition in sendTextMessage.
  - @unctad-ai/voice-agent-registries@5.3.1

## 5.3.0

### Patch Changes

- e499ac9: Message bubbles with tinting, empty state with avatar and suggested prompt chips, collapsed bar message preview.
  - @unctad-ai/voice-agent-registries@5.3.0

## 5.2.6

### Patch Changes

- b52dad5: fix(core): resolve Chrome AudioContext sample-rate mismatch in useTenVAD

  Create AudioContext at native device rate instead of forcing 16 kHz, and resample
  to 16 kHz inside the AudioWorklet processor. Chrome throws DOMException when
  MediaStream and AudioContext sample rates differ; Firefox resamples silently.

  - @unctad-ai/voice-agent-registries@5.2.6

## 5.2.5

### Patch Changes

- @unctad-ai/voice-agent-registries@5.2.5

## 5.2.4

### Patch Changes

- @unctad-ai/voice-agent-registries@5.2.4

## 5.2.3

### Patch Changes

- a793f8c: Increase default mic idle timeout from 15s to 30s.
  - @unctad-ai/voice-agent-registries@5.2.3

## 5.2.2

### Patch Changes

- a919830: Add excludeRoutes config to hide voice agent on specific pages. Increase FAB avatar to 80px.
  - @unctad-ai/voice-agent-registries@5.2.2

## 5.2.1

### Patch Changes

- @unctad-ai/voice-agent-registries@5.2.1

## 5.2.0

### Minor Changes

- 2cdf9f9: Larger FAB (68px) with animated tooltip introducing the voice agent as a virtual civil servant. First-visit greeting with CTA, return-visit re-engagement with 30min cooldown.

### Patch Changes

- @unctad-ai/voice-agent-registries@5.2.0

## 5.1.3

### Patch Changes

- ffe5163: Reduce mic idle timeout from 60s to 15s and prevent background noise from resetting it. VAD bouncing no longer extends the countdown; long utterances are safely rescheduled instead of cut off.
  - @unctad-ai/voice-agent-registries@5.1.3

## 5.1.2

### Patch Changes

- @unctad-ai/voice-agent-registries@5.1.2

## 5.1.1

### Patch Changes

- Updated dependencies [243e44d]
  - @unctad-ai/voice-agent-registries@5.1.1

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
  - @unctad-ai/voice-agent-registries@5.1.0

## 5.0.6

### Patch Changes

- @unctad-ai/voice-agent-registries@5.0.6

## 5.0.5

### Patch Changes

- @unctad-ai/voice-agent-registries@5.0.5

## 5.0.4

### Patch Changes

- @unctad-ai/voice-agent-registries@5.0.4

## 5.0.3

### Patch Changes

- @unctad-ai/voice-agent-registries@5.0.3

## 5.0.2

### Patch Changes

- @unctad-ai/voice-agent-registries@5.0.2

## 5.0.1

### Patch Changes

- @unctad-ai/voice-agent-registries@5.0.1

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
  - @unctad-ai/voice-agent-registries@5.0.0

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
  - @unctad-ai/voice-agent-registries@4.0.0

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
  - @unctad-ai/voice-agent-registries@3.0.3

## 3.0.2

### Patch Changes

- e38eaac: Pipeline hardening fixes: streaming TTS with temperature passthrough, SILENT UX cleanup, browser AGC instead of server gain normalization, version logging
  - @unctad-ai/voice-agent-registries@3.0.2

## 3.0.1

### Patch Changes

- @unctad-ai/voice-agent-registries@3.0.1

## 3.0.0

### Minor Changes

- 4663240: WebSocket pipeline hardening: state machines, async queue, turn boundaries, echo guard, audio buffering, error propagation

### Patch Changes

- @unctad-ai/voice-agent-registries@3.0.0

## 2.0.5

### Patch Changes

- @unctad-ai/voice-agent-registries@2.0.5

## 2.0.4

### Patch Changes

- 4908b38: fix: convert Int16 PCM to Float32 for TTS playback, fix Processing/Speaking/Listening state transitions
  - @unctad-ai/voice-agent-registries@2.0.4

## 2.0.3

### Patch Changes

- 87eacb3: fix: guard sendAudio against null WebSocket, add debug logging to WebSocket handler
  - @unctad-ai/voice-agent-registries@2.0.3

## 2.0.2

### Patch Changes

- @unctad-ai/voice-agent-registries@2.0.2

## 2.0.1

### Patch Changes

- @unctad-ai/voice-agent-registries@2.0.1

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
  - @unctad-ai/voice-agent-registries@2.0.0

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
