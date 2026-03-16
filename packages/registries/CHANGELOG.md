# @unctad-ai/voice-agent-registries

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

- Updated dependencies [e38eaac]
  - @unctad-ai/voice-agent-core@3.0.2

## 3.0.1

### Patch Changes

- @unctad-ai/voice-agent-core@3.0.1

## 3.0.0

### Patch Changes

- Updated dependencies [4663240]
  - @unctad-ai/voice-agent-core@3.0.0

## 2.0.5

### Patch Changes

- @unctad-ai/voice-agent-core@2.0.5

## 2.0.4

### Patch Changes

- Updated dependencies [4908b38]
  - @unctad-ai/voice-agent-core@2.0.4

## 2.0.3

### Patch Changes

- Updated dependencies [87eacb3]
  - @unctad-ai/voice-agent-core@2.0.3

## 2.0.2

### Patch Changes

- @unctad-ai/voice-agent-core@2.0.2

## 2.0.1

### Patch Changes

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

- Updated dependencies [47d357b]
  - @unctad-ai/voice-agent-core@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [fac530f]
  - @unctad-ai/voice-agent-core@1.0.9

## 1.0.8

### Patch Changes

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

- @unctad-ai/voice-agent-core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [9506d2f]
  - @unctad-ai/voice-agent-core@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [6fe4674]
  - @unctad-ai/voice-agent-core@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [720109d]
  - @unctad-ai/voice-agent-core@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [2221a03]
  - @unctad-ai/voice-agent-core@1.0.0

## 0.1.8

### Patch Changes

- Updated dependencies [6fe2cc7]
  - @unctad-ai/voice-agent-core@0.1.8

## 0.1.7

### Patch Changes

- a1731a6: Fix "Processing..." stall during multi-step form filling: prevent onToolCall replay for historical tool calls, auto-recover when SDK is idle but voice state is stuck, and improve performUIAction error messages to list available actions.
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
