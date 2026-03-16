# WebSocket Voice Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the HTTP REST STT/LLM/TTS pipeline with a single persistent WebSocket connection, reducing voice round-trip latency from ~3-6s to ~1.5-3s.

**Architecture:** Stateless Express WebSocket bridge connects browser to Python STT (WebSocket), Groq LLM (HTTP), and TTS GPU (HTTP). Client streams raw PCM over binary WebSocket frames. Server orchestrates STT→LLM→TTS per turn. Client tools use request/response callbacks over WebSocket.

**Tech Stack:** TypeScript (Node/Express + `ws`), Python (FastAPI + WebSocket), React hooks, Groq SDK, PyTorch/Mimi codec

**Spec:** `docs/superpowers/specs/2026-03-13-websocket-voice-pipeline-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `packages/server/src/protocol.ts` | Shared event type definitions, send/parse helpers |
| `packages/server/src/textUtils.ts` | Extracted `sanitizeForTTS`, `stripChainOfThought` |
| `packages/server/src/ttsProviders.ts` | Extracted TTS provider functions (qwen3, chatterbox, cosyvoice, pocket, resemble) |
| `packages/server/src/sttStreamClient.ts` | WebSocket client to Python STT service |
| `packages/server/src/voicePipeline.ts` | Per-turn STT→LLM→TTS orchestrator with abort/barge-in |
| `packages/server/src/createVoiceWebSocketHandler.ts` | WebSocket upgrade handler, session routing |
| `packages/server/src/__tests__/protocol.test.ts` | Tests for event parsing/serialization |
| `packages/server/src/__tests__/textUtils.test.ts` | Tests for sanitization (extracted from createTtsHandler) |
| `packages/server/src/__tests__/voicePipeline.test.ts` | Tests for pipeline orchestration with mocked services |
| `packages/core/src/protocol/events.ts` | Client-side TypeScript event types (mirrors server protocol.ts) |
| `packages/core/src/services/voiceWebSocket.ts` | WebSocket connection manager (connect, reconnect, event dispatch) |
| `packages/core/src/hooks/useVoiceWebSocket.ts` | Main client hook: WebSocket events → state management |
| `packages/server/src/types.ts` | Shared `VoiceServerOptions` interface (avoids circular imports) |

**Separate repo** (`/Users/moulaymehdi/PROJECTS/figma/gpu-services/` — NOT inside voice-agent-kit):

| File | Responsibility |
|------|----------------|
| `kyutai-stt/test_streaming.py` | Pytest tests for the new WebSocket STT endpoint |

### Modified Files

| File | Change |
|------|--------|
| `packages/server/src/index.ts` | Replace exports: remove `createVoiceRoutes` + individual handlers, add `attachVoicePipeline` |
| `packages/server/package.json` | Add `ws` + `@types/ws` dependencies |
| `packages/server/tsconfig.json` | Possibly add test paths |
| `packages/core/src/index.ts` | Remove voiceApi/audioUtils/wavParser exports, add `checkPipelineHealth` |
| `packages/core/src/hooks/useVoiceAgent.ts` | Rewrite internals to use `useVoiceWebSocket`, preserve return type |
| `packages/core/src/hooks/useTenVAD.ts` | Add `onRawAudio` callback for per-frame PCM streaming |
| `packages/core/src/hooks/useAudioPlayback.ts` | Accept PCM from WebSocket binary frames instead of HTTP response |
| `packages/core/package.json` | Remove `@ai-sdk/react` peer dependency |


**Separate repo** (`/Users/moulaymehdi/PROJECTS/figma/gpu-services/`):

| File | Change |
|------|--------|
| `kyutai-stt/server.py` | Add `WebSocket /ws/transcribe` endpoint with batched inference |

### Removed Files (at end)

| File | Reason |
|------|--------|
| `packages/server/src/createSttHandler.ts` | Replaced by `sttStreamClient.ts` |
| `packages/server/src/createTtsHandler.ts` | Logic moved to `ttsProviders.ts` + `voicePipeline.ts` |
| `packages/server/src/createChatHandler.ts` | LLM calls moved into `voicePipeline.ts` |
| `packages/core/src/services/voiceApi.ts` | HTTP wrappers replaced by WebSocket |
| `packages/core/src/utils/audioUtils.ts` | WAV encoding no longer needed |
| `packages/core/src/utils/wavParser.ts` | WAV parsing no longer needed |

---

## Chunk 1: Shared Protocol & Server Extractions

Foundation work: event types, text utilities extraction, TTS provider extraction. No behavioral changes — just restructuring existing code into reusable modules.

### Task 1: Set up vitest for server package

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/vitest.config.ts`

- [ ] **Step 1: Add vitest as dev dependency**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit
pnpm add -D vitest --filter @unctad-ai/voice-agent-server
```

- [ ] **Step 2: Create vitest config**

Create `packages/server/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `packages/server/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
cd packages/server && pnpm test
```
Expected: "No test files found" or similar — confirms vitest is configured.

- [ ] **Step 5: Commit**

```bash
git add packages/server/package.json packages/server/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(server): add vitest for unit testing"
```

---

### Task 2: Create shared protocol types (`protocol.ts`)

**Files:**
- Create: `packages/server/src/protocol.ts`
- Create: `packages/server/src/__tests__/protocol.test.ts`

- [ ] **Step 1: Write tests for protocol helpers**

Create `packages/server/src/__tests__/protocol.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  createEvent,
  parseEvent,
  isAudioFrame,
  type ClientEvent,
  type ServerEvent,
} from '../protocol.js';

describe('protocol', () => {
  describe('createEvent', () => {
    it('serializes a server event to JSON string', () => {
      const json = createEvent('session.created', { session_id: 'abc' });
      const parsed = JSON.parse(json);
      expect(parsed).toEqual({ type: 'session.created', session_id: 'abc' });
    });

    it('serializes event with no payload', () => {
      const json = createEvent('response.audio.done', {});
      expect(JSON.parse(json)).toEqual({ type: 'response.audio.done' });
    });
  });

  describe('parseEvent', () => {
    it('parses valid JSON client event', () => {
      const raw = JSON.stringify({ type: 'session.update', conversation: [] });
      const event = parseEvent(raw);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('session.update');
    });

    it('returns null for invalid JSON', () => {
      expect(parseEvent('not json')).toBeNull();
    });

    it('returns null for missing type field', () => {
      expect(parseEvent(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });
  });

  describe('isAudioFrame', () => {
    it('returns true for Buffer with Float32 length', () => {
      // 1920 Float32 samples = 7680 bytes
      const buf = Buffer.alloc(7680);
      expect(isAudioFrame(buf)).toBe(true);
    });

    it('returns false for empty buffer', () => {
      expect(isAudioFrame(Buffer.alloc(0))).toBe(false);
    });

    it('returns false for non-multiple-of-4 length', () => {
      expect(isAudioFrame(Buffer.alloc(7))).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && pnpm test
```
Expected: FAIL — `../protocol.js` does not exist.

- [ ] **Step 3: Implement protocol.ts**

Create `packages/server/src/protocol.ts`:
```typescript
/**
 * WebSocket voice pipeline protocol.
 *
 * Binary frames = raw PCM audio (Float32, no wrapper).
 * Text frames = JSON events with { type: "event.name", ...payload }.
 *
 * Based on OpenAI Realtime API conventions with voice-agent.* extensions.
 */

// ── Client → Server events ──────────────────────────────────────────

export interface SessionUpdateEvent {
  type: 'session.update';
  conversation: unknown[]; // Message[] from @ai-sdk/react — kept as unknown to avoid dependency
  config: Record<string, unknown>;
  voice_settings?: Record<string, unknown>;
  language?: string;
}

export interface InputAudioCommitEvent {
  type: 'input_audio_buffer.commit';
}

export interface InputAudioClearEvent {
  type: 'input_audio_buffer.clear';
}

export interface ResponseCancelEvent {
  type: 'response.cancel';
}

export interface ToolResultEvent {
  type: 'voice-agent.tool_result';
  tool_call_id: string;
  result: unknown;
}

export type ClientEvent =
  | SessionUpdateEvent
  | InputAudioCommitEvent
  | InputAudioClearEvent
  | ResponseCancelEvent
  | ToolResultEvent;

// ── Server → Client events ──────────────────────────────────────────

export interface SessionCreatedEvent {
  type: 'session.created';
  session_id: string;
}

export interface SpeechStartedEvent {
  type: 'input_audio_buffer.speech_started';
}

export interface SpeechStoppedEvent {
  type: 'input_audio_buffer.speech_stopped';
}

export interface ConversationItemCreatedEvent {
  type: 'conversation.item.created';
  message: unknown;
}

export interface ResponseTextDeltaEvent {
  type: 'response.text.delta';
  delta: string;
}

export interface ResponseTextDoneEvent {
  type: 'response.text.done';
  text: string;
}

export interface ResponseAudioDoneEvent {
  type: 'response.audio.done';
}

export interface ToolCallEvent {
  type: 'voice-agent.tool_call';
  tool_call_id: string;
  name: string;
  arguments: unknown;
}

export interface SttResultEvent {
  type: 'voice-agent.stt_result';
  text: string;
  noSpeechProb: number;
  avgLogprob: number;
  durationMs: number;
}

export interface StatusEvent {
  type: 'voice-agent.status';
  status: 'listening' | 'processing' | 'speaking';
}

export interface ErrorEvent {
  type: 'voice-agent.error';
  code: string;
  message: string;
}

export interface TimingsEvent {
  type: 'voice-agent.timings';
  sttMs?: number;
  llmFirstTokenMs?: number;
  llmTotalMs?: number;
  ttsFirstChunkMs?: number;
  ttsTotalMs?: number;
  totalMs?: number;
}

export type ServerEvent =
  | SessionCreatedEvent
  | SpeechStartedEvent
  | SpeechStoppedEvent
  | ConversationItemCreatedEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseAudioDoneEvent
  | ToolCallEvent
  | SttResultEvent
  | StatusEvent
  | ErrorEvent
  | TimingsEvent;

// ── Helpers ─────────────────────────────────────────────────────────

/** Serialize a server event to a JSON string for sending over WebSocket text frame. */
export function createEvent<T extends ServerEvent['type']>(
  type: T,
  payload: Omit<Extract<ServerEvent, { type: T }>, 'type'>,
): string {
  return JSON.stringify({ type, ...payload });
}

/** Parse a JSON text frame into a client event. Returns null if invalid. */
export function parseEvent(raw: string): ClientEvent | null {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null || typeof obj.type !== 'string') {
      return null;
    }
    return obj as ClientEvent;
  } catch {
    return null;
  }
}

/** Check if a binary WebSocket message is a valid PCM audio frame (Float32 = 4 bytes per sample). */
export function isAudioFrame(data: Buffer): boolean {
  return data.length > 0 && data.length % 4 === 0;
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && pnpm test
```
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/protocol.ts packages/server/src/__tests__/protocol.test.ts
git commit -m "feat(server): add WebSocket protocol types and helpers"
```

---

### Task 3: Extract text utilities (`textUtils.ts`)

**Files:**
- Create: `packages/server/src/textUtils.ts`
- Create: `packages/server/src/__tests__/textUtils.test.ts`
- Read: `packages/server/src/createTtsHandler.ts` (source of functions to extract)

- [ ] **Step 1: Write tests for text utilities**

Create `packages/server/src/__tests__/textUtils.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { sanitizeForTTS, stripChainOfThought } from '../textUtils.js';

describe('stripChainOfThought', () => {
  it('strips tagged CoT', () => {
    expect(stripChainOfThought('<think>reasoning here</think>actual answer'))
      .toBe('actual answer');
  });

  it('strips multiline tagged CoT', () => {
    expect(stripChainOfThought('<think>\nline1\nline2\n</think>answer'))
      .toBe('answer');
  });

  it('strips untagged CoT with reasoning patterns', () => {
    const input = 'we need to check the rules\n\nThe answer is 42.';
    expect(stripChainOfThought(input)).toBe('The answer is 42.');
  });

  it('preserves normal text without CoT', () => {
    expect(stripChainOfThought('Hello, how can I help?')).toBe('Hello, how can I help?');
  });
});

describe('sanitizeForTTS', () => {
  it('strips markdown bold', () => {
    expect(sanitizeForTTS('**bold text**')).toBe('bold text');
  });

  it('strips emoji', () => {
    const result = sanitizeForTTS('Hello! 😀 How are you?');
    expect(result).not.toContain('😀');
  });

  it('replaces & with "and"', () => {
    expect(sanitizeForTTS('salt & pepper')).toBe('salt and pepper');
  });

  it('strips bracketed stage directions', () => {
    expect(sanitizeForTTS('Hello [END_SESSION]')).toBe('Hello');
  });

  it('caps text at maxWords', () => {
    const longText = Array(100).fill('word').join(' ') + '.';
    const result = sanitizeForTTS(longText, 10);
    const wordCount = result.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(11); // 10 + potential trailing
  });

  it('strips CoT before sanitizing', () => {
    const input = '<think>let me think</think>**Answer here**';
    expect(sanitizeForTTS(input)).toBe('Answer here');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && pnpm test
```
Expected: FAIL — `../textUtils.js` does not exist.

- [ ] **Step 3: Extract functions from createTtsHandler.ts into textUtils.ts**

Create `packages/server/src/textUtils.ts` by copying `stripChainOfThought` (lines 31-48) and `sanitizeForTTS` (lines 54-93) from `packages/server/src/createTtsHandler.ts`. These are pure functions with no dependencies.

```typescript
/**
 * Text sanitization for TTS engines.
 * Extracted from createTtsHandler.ts for reuse in voicePipeline.ts.
 */

/**
 * Strip reasoning-model chain-of-thought from LLM output.
 *
 * Two patterns:
 * 1. Tagged: <think>reasoning</think>actual answer
 * 2. Untagged: reasoning paragraphs + \n\n + actual answer (last paragraph)
 */
export function stripChainOfThought(raw: string): string {
  let text = raw;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    const reasoningPatterns = /\b(we need to|we should|we must|according to rules|the user says|ensure no|two sentences|under \d+ words|no markdown|no contractions|let me think|so we|that'?s \d+ sentences)\b/i;
    const hasReasoning = paragraphs.slice(0, -1).some(p => reasoningPatterns.test(p));
    if (hasReasoning) {
      text = paragraphs[paragraphs.length - 1];
    }
  }

  return text.trim();
}

/**
 * Sanitize text for TTS engines.
 * Strips CoT, markdown, emoji, escapes SSML chars, caps word count.
 */
export function sanitizeForTTS(raw: string, maxWords = 60): string {
  let text = stripChainOfThought(raw)
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2705}\u{274C}\u{2714}\u{2716}]/gu, '')
    .replace(/[\u{2010}\u{2011}\u{2012}\u{2013}\u{2014}\u{2015}]/gu, '-')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/^\|.*\|$/gm, '')
    .replace(/^\|[-:| ]+\|$/gm, '')
    .replace(/\|/g, ',')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^[\s]*[-*]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\[[^\]]{2,}\]/g, '')
    .replace(/&/g, 'and')
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\.\s*\./g, '.')
    .trim();

  const words = text.split(/\s+/);
  if (words.length > maxWords) {
    const joined = words.slice(0, maxWords).join(' ');
    const lastSentence = Math.max(joined.lastIndexOf('. '), joined.lastIndexOf('? '));
    text = lastSentence > 0 ? joined.slice(0, lastSentence + 1) : joined.replace(/[,;:\s]+$/, '') + '.';
  }

  return text;
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && pnpm test
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/textUtils.ts packages/server/src/__tests__/textUtils.test.ts
git commit -m "refactor(server): extract text sanitization into textUtils.ts"
```

---

### Task 4: Extract TTS providers (`ttsProviders.ts`)

**Files:**
- Create: `packages/server/src/ttsProviders.ts`
- Read: `packages/server/src/createTtsHandler.ts` (lines 97-196 — provider functions)

- [ ] **Step 1: Create ttsProviders.ts**

Extract the 5 `synthesizeWith*` functions and the `buildWavHeader`-like utilities from `createTtsHandler.ts` (lines 97-196). These are pure async functions that call external TTS services — no Express dependency.

Create `packages/server/src/ttsProviders.ts`:
```typescript
/**
 * TTS provider functions extracted from createTtsHandler.ts.
 * Each function calls an external TTS service and returns a fetch Response.
 * Used by voicePipeline.ts to synthesize audio during WebSocket turns.
 */

export async function synthesizeWithQwen3TTS(
  text: string,
  url: string,
  signal?: AbortSignal,
  opts?: { temperature?: number; voice?: string },
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);
  if (opts?.temperature != null) formData.append('temperature', String(opts.temperature));
  if (opts?.voice) formData.append('voice', opts.voice);

  const providerTimeout = AbortSignal.timeout(50_000);
  return fetch(`${url}/tts-pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export async function synthesizeWithChatterboxTurbo(
  text: string,
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);

  const providerTimeout = AbortSignal.timeout(30_000);
  return fetch(`${url}/tts-pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export async function synthesizeWithCosyVoice(
  text: string,
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);

  const providerTimeout = AbortSignal.timeout(15_000);
  return fetch(`${url}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export async function synthesizeWithPocketTTS(
  text: string,
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);

  const providerTimeout = AbortSignal.timeout(30_000);
  return fetch(`${url}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export async function synthesizeWithResemble(
  text: string,
  apiKey: string,
  model: string,
  voiceUuid: string,
  signal?: AbortSignal,
): Promise<Response> {
  const providerTimeout = AbortSignal.timeout(10_000);
  return fetch('https://f.cluster.resemble.ai/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'voice-agent-kit/1.0',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      voice_uuid: voiceUuid,
      data: text,
      output_format: 'wav',
    }),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export interface TtsProviderConfig {
  ttsProvider: string;
  qwen3TtsUrl: string;
  chatterboxTurboUrl: string;
  cosyVoiceTtsUrl: string;
  pocketTtsUrl: string;
  resembleApiKey: string;
  resembleModel: string;
  resembleVoiceUuid: string;
  ttsFallback: boolean;
  getActiveVoiceId?: () => string;
}

/**
 * Synthesize text with the configured TTS provider, applying fallback chain.
 * Returns a streaming Response or throws on total failure.
 */
export async function synthesize(
  text: string,
  config: TtsProviderConfig,
  signal?: AbortSignal,
  opts?: { temperature?: number },
): Promise<Response> {
  const voiceId = config.getActiveVoiceId?.() || '';
  const { ttsProvider, ttsFallback } = config;

  let response: Response;

  if (ttsProvider === 'qwen3-tts') {
    response = await synthesizeWithQwen3TTS(text, config.qwen3TtsUrl, signal, { temperature: opts?.temperature, voice: voiceId });
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] qwen3-tts failed, falling back to pocket-tts');
      response = await synthesizeWithPocketTTS(text, config.pocketTtsUrl, signal);
      if (!response.ok) {
        console.warn('[TTS] pocket-tts failed, falling back to Resemble');
        response = await synthesizeWithResemble(text, config.resembleApiKey, config.resembleModel, config.resembleVoiceUuid, signal);
      }
    }
  } else if (ttsProvider === 'chatterbox-turbo') {
    response = await synthesizeWithChatterboxTurbo(text, config.chatterboxTurboUrl, signal);
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] chatterbox-turbo failed, falling back to pocket-tts');
      response = await synthesizeWithPocketTTS(text, config.pocketTtsUrl, signal);
      if (!response.ok) {
        response = await synthesizeWithResemble(text, config.resembleApiKey, config.resembleModel, config.resembleVoiceUuid, signal);
      }
    }
  } else if (ttsProvider === 'cosyvoice') {
    response = await synthesizeWithCosyVoice(text, config.cosyVoiceTtsUrl, signal);
    if (!response.ok && ttsFallback) {
      response = await synthesizeWithPocketTTS(text, config.pocketTtsUrl, signal);
      if (!response.ok) {
        response = await synthesizeWithResemble(text, config.resembleApiKey, config.resembleModel, config.resembleVoiceUuid, signal);
      }
    }
  } else if (ttsProvider === 'pocket-tts') {
    response = await synthesizeWithPocketTTS(text, config.pocketTtsUrl, signal);
    if (!response.ok && ttsFallback) {
      response = await synthesizeWithResemble(text, config.resembleApiKey, config.resembleModel, config.resembleVoiceUuid, signal);
    }
  } else {
    response = await synthesizeWithResemble(text, config.resembleApiKey, config.resembleModel, config.resembleVoiceUuid, signal);
  }

  return response;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd packages/server && pnpm build
```
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ttsProviders.ts
git commit -m "refactor(server): extract TTS provider functions into ttsProviders.ts"
```

---

## Chunk 2: Python STT WebSocket Upgrade

Adds the streaming WebSocket endpoint to the existing Kyutai STT server alongside the batch HTTP endpoint.

### Task 5: Add WebSocket streaming endpoint to Python STT

> **NOTE:** This task works in a **separate repo**: `/Users/moulaymehdi/PROJECTS/figma/gpu-services/`.
> It requires its own git add/commit/push cycle, and deployment to the GPU server via `docker compose up --build -d`.

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/gpu-services/kyutai-stt/server.py`
- Create: `/Users/moulaymehdi/PROJECTS/figma/gpu-services/kyutai-stt/test_streaming.py`

- [ ] **Step 1: Write test for WebSocket STT endpoint**

Create `/Users/moulaymehdi/PROJECTS/figma/gpu-services/kyutai-stt/test_streaming.py`. This test mocks the model to verify the WebSocket protocol without a GPU:

```python
"""
Tests for the WebSocket /ws/transcribe endpoint.
Mocks the model layer — tests protocol handling, batching, and lifecycle only.
Run with: pytest test_streaming.py -v
"""
import asyncio
import json
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

# We test the protocol layer only — GPU model is mocked
# Import will be done after mocking to avoid model load


def make_pcm_frame(n_samples=1920, value=0.0):
    """Create a JSON-encoded audio message with n_samples float32 PCM."""
    return json.dumps({"type": "audio", "pcm": [value] * n_samples})


@pytest.fixture
def mock_model_state():
    """Mock model_state so server.py doesn't try to load GPU model."""
    import server
    original = dict(server.model_state)
    server.model_state.update({
        "loaded": True,
        "device": "cpu",
        "mimi": MagicMock(),
        "lm_gen": MagicMock(),
        "lm": MagicMock(),
        "text_tokenizer": MagicMock(),
        "frame_size": 1920,
        "stt_config": {"audio_silence_prefix_seconds": 0.0, "audio_delay_seconds": 0.0},
        "lm_gen_config": {},
        "dtype": "float32",
    })
    yield server
    server.model_state.clear()
    server.model_state.update(original)


class TestWebSocketProtocol:
    """Test WebSocket message handling without GPU."""

    def test_reset_message_accepted(self, mock_model_state):
        """Server should accept reset messages without error."""
        client = TestClient(mock_model_state.app)
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_text(json.dumps({"type": "reset"}))
            # Should not raise — reset is valid at any time

    def test_invalid_json_ignored(self, mock_model_state):
        """Server should ignore malformed messages."""
        client = TestClient(mock_model_state.app)
        with client.websocket_connect("/ws/transcribe") as ws:
            ws.send_text("not json at all")
            # Should not crash
```

- [ ] **Step 2: Install test dependencies**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/gpu-services/kyutai-stt
pip install pytest httpx  # httpx required by FastAPI TestClient for WebSocket
```

- [ ] **Step 3: Add WebSocket endpoint to server.py**

Add the following to `/Users/moulaymehdi/PROJECTS/figma/gpu-services/kyutai-stt/server.py` after the existing `/v1/audio/transcriptions` endpoint (after line 224). Read the file first to find the exact insertion point.

Key implementation details:
- `@app.websocket("/ws/transcribe")` endpoint
- Accepts JSON messages: `audio` (PCM frame), `flush` (drain lookahead), `reset` (new turn)
- Each connection gets a batch slot (up to `STT_BATCH_SIZE`, default 4, from env var)
- Background asyncio task ticks at 12.5Hz, processes all active slots in one batch
- Emits `word`, `vad`, `done` JSON messages back to client
- On `flush`: feeds silence frames to drain the model's lookahead buffer
- On connection close: releases batch slot

The full implementation should follow the spec's batched inference design (spec lines 169-184). The implementer should read `server.py` lines 140-220 for the existing frame-by-frame inference pattern and adapt it for the batch loop.

- [ ] **Step 4: Run tests**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/gpu-services/kyutai-stt && pytest test_streaming.py -v
```
Expected: Protocol tests PASS (model is mocked).

- [ ] **Step 5: Commit (in gpu-services repo)**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/gpu-services
git add kyutai-stt/server.py kyutai-stt/test_streaming.py
git commit -m "feat(stt): add WebSocket /ws/transcribe endpoint with batched inference"
```

---

## Chunk 3: Server WebSocket Handler & Pipeline

The core server-side changes: STT WebSocket client, voice pipeline orchestrator, and the WebSocket upgrade handler.

### Task 6: STT stream client (`sttStreamClient.ts`)

**Files:**
- Create: `packages/server/src/sttStreamClient.ts`

- [ ] **Step 1: Add ws dependency**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit
pnpm add ws --filter @unctad-ai/voice-agent-server
pnpm add -D @types/ws --filter @unctad-ai/voice-agent-server
```

- [ ] **Step 2: Implement sttStreamClient.ts**

This module manages a WebSocket connection to the Python STT server. It:
- Connects to `ws://host:8003/ws/transcribe`
- Forwards raw PCM Float32 frames as binary WebSocket frames (not JSON — avoids serialization overhead)
- Receives `word`, `vad`, `done` events
- Exposes methods: `sendAudio(pcm: Float32Array)`, `flush()`, `reset()`, `close()`
- Emits events via callback: `onWord(text)`, `onVad(probs)`, `onDone(text, vadProbs)`
- Auto-reconnects with backoff on disconnect
- Reports connection status

```typescript
import WebSocket from 'ws';

export interface SttStreamCallbacks {
  onWord?: (text: string, tokenId: number) => void;
  onVad?: (probs: number[]) => void;
  onDone?: (text: string, vadProbs: number[], durationMs: number) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class SttStreamClient {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: SttStreamCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private closed = false;

  constructor(url: string, callbacks: SttStreamCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => {
        this.reconnectDelay = 1000;
        this.callbacks.onConnected?.();
      });
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'word') this.callbacks.onWord?.(msg.text, msg.token_id);
          else if (msg.type === 'vad') this.callbacks.onVad?.(msg.probs);
          else if (msg.type === 'done') this.callbacks.onDone?.(msg.text, msg.vadProbs, msg.durationMs ?? 0);
        } catch { /* ignore malformed */ }
      });
      this.ws.on('close', () => {
        this.callbacks.onDisconnected?.();
        this.scheduleReconnect();
      });
      this.ws.on('error', (err) => {
        this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  sendAudio(pcm: Float32Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Send as binary frame (raw Float32 bytes) — avoids ~15KB/frame JSON overhead.
    // Python server distinguishes binary (audio) from text (JSON control messages).
    this.ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  flush(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'flush' }));
  }

  reset(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'reset' }));
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd packages/server && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/sttStreamClient.ts packages/server/package.json pnpm-lock.yaml
git commit -m "feat(server): add STT WebSocket stream client"
```

---

### Task 7: Voice pipeline orchestrator (`voicePipeline.ts`)

**Files:**
- Create: `packages/server/src/voicePipeline.ts`
- Create: `packages/server/src/__tests__/voicePipeline.test.ts`

This is the core orchestration logic. One `VoicePipeline` instance per WebSocket session. It:
- Holds a reference to the `SttStreamClient` (shared across turns)
- On `commit` (speech end): collects STT result, calls LLM, streams TTS
- On `cancel` (barge-in): aborts current turn via AbortController
- Calls `buildSystemPrompt` and `createBuiltinTools` for LLM context
- Handles client tool call/result round-trips (max 25)
- Sends all events via a `send(event)` callback

- [ ] **Step 1: Write test for pipeline turn lifecycle**

Create `packages/server/src/__tests__/voicePipeline.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { sanitizeForTTS } from '../textUtils.js';

// Test the text processing that the pipeline uses
// Full pipeline integration tests require mocking Groq SDK + TTS fetch,
// which will be done in integration testing phase.

describe('voicePipeline text processing', () => {
  it('sanitizes LLM output before TTS', () => {
    const llmOutput = '<think>reasoning</think>**Hello!** How can I help? [END_SESSION]';
    const sanitized = sanitizeForTTS(llmOutput);
    expect(sanitized).not.toContain('<think>');
    expect(sanitized).not.toContain('**');
    expect(sanitized).not.toContain('[END_SESSION]');
    expect(sanitized).toContain('Hello');
  });
});
```

- [ ] **Step 2: Implement voicePipeline.ts**

The implementer MUST read these files before starting:
- `packages/server/src/createChatHandler.ts` — for `buildSystemPrompt`, `streamText`, and tool handling patterns
- `packages/server/src/createTtsHandler.ts` — for TTS streaming response reading pattern (lines 329-358)
- `packages/server/src/builtinTools.ts` — for `createBuiltinTools` and the server/client tool split

```typescript
import { streamText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { SttStreamClient } from './sttStreamClient.js';
import { synthesize, type TtsProviderConfig } from './ttsProviders.js';
import { sanitizeForTTS } from './textUtils.js';
import { createEvent } from './protocol.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { createBuiltinTools } from './builtinTools.js';

export interface VoicePipelineOptions {
  sttClient: SttStreamClient;
  ttsConfig: TtsProviderConfig;
  groqApiKey: string;
  groqModel?: string;
  send: (event: string) => void;        // Send JSON text frame
  sendBinary: (data: Buffer) => void;    // Send binary audio frame
  siteConfig: Record<string, unknown>;
}

export class VoicePipeline {
  private turnAbort: AbortController | null = null;
  private conversation: unknown[] = [];
  private language = 'en';
  private voiceSettings: Record<string, unknown> = {};
  private roundTripCount = 0;
  private readonly maxRoundTrips = 25;
  private pendingToolCalls = new Map<string, (result: unknown) => void>();
  private groq: ReturnType<typeof createGroq>;
  private opts: VoicePipelineOptions;

  constructor(opts: VoicePipelineOptions) {
    this.opts = opts;
    this.groq = createGroq({ apiKey: opts.groqApiKey });
  }

  /** Called on session.update — stores conversation and config. */
  setSession(event: { conversation: unknown[]; config: Record<string, unknown>; voice_settings?: Record<string, unknown>; language?: string }): void {
    this.conversation = event.conversation;
    this.language = event.language || 'en';
    this.voiceSettings = event.voice_settings || {};
  }

  /** Called on voice-agent.tool_result — resolves a pending client tool call. */
  resolveToolCall(toolCallId: string, result: unknown): void {
    const resolve = this.pendingToolCalls.get(toolCallId);
    if (resolve) {
      this.pendingToolCalls.delete(toolCallId);
      resolve(result);
    }
  }

  /** Abort the current turn (barge-in or cancel). */
  cancel(): void {
    this.turnAbort?.abort();
    this.turnAbort = null;
  }

  /**
   * Execute one voice turn: STT result → LLM → TTS.
   *
   * Called after input_audio_buffer.commit (STT flush already triggered).
   * The STT client will emit a 'done' event with the final transcript.
   */
  async startTurn(): Promise<void> {
    this.turnAbort = new AbortController();
    const { signal } = this.turnAbort;
    const t0 = performance.now();
    this.roundTripCount = 0;

    this.opts.send(createEvent('voice-agent.status', { status: 'processing' }));

    try {
      // 1. Wait for STT done event (flush was already called by the handler)
      const sttResult = await this.waitForSttDone(signal);
      const sttMs = Math.round(performance.now() - t0);

      // 2. Send STT result to client for display
      this.opts.send(createEvent('voice-agent.stt_result', {
        text: sttResult.text,
        noSpeechProb: sttResult.noSpeechProb,
        avgLogprob: sttResult.avgLogprob,
        durationMs: sttMs,
      }));

      // 3. Hallucination filter (same thresholds as current client-side)
      if (!sttResult.text.trim() || sttResult.noSpeechProb > 0.6 || sttResult.avgLogprob < -0.7) {
        this.opts.send(createEvent('voice-agent.status', { status: 'listening' }));
        return;
      }

      // 4. Add user message to conversation
      const userMessage = { role: 'user', content: sttResult.text };
      this.conversation.push(userMessage);
      this.opts.send(createEvent('conversation.item.created', { message: userMessage }));

      // 5. LLM generation loop (handles tool calls)
      const fullText = await this.runLlm(signal);

      // 6. TTS
      if (fullText.trim()) {
        this.opts.send(createEvent('voice-agent.status', { status: 'speaking' }));
        const sanitized = sanitizeForTTS(fullText);
        await this.runTts(sanitized, signal);
      }

      // 7. Timings
      this.opts.send(createEvent('voice-agent.timings', {
        sttMs,
        totalMs: Math.round(performance.now() - t0),
      }));

    } catch (err) {
      if (signal.aborted) return; // Cancelled — expected, no error
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.send(createEvent('voice-agent.error', { code: 'pipeline_error', message: msg }));
    } finally {
      this.opts.send(createEvent('voice-agent.status', { status: 'listening' }));
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  /** Wait for the STT client to emit a 'done' event. */
  private waitForSttDone(signal: AbortSignal): Promise<{ text: string; noSpeechProb: number; avgLogprob: number }> {
    return new Promise((resolve, reject) => {
      // The SttStreamClient's onDone callback is set by the handler.
      // We temporarily override it to capture this turn's result.
      // Implementation detail: the handler should wire sttClient.onDone
      // to call pipeline.resolveSttDone(). Use a similar pattern to pendingToolCalls.
      const onAbort = () => reject(new Error('cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
      // ... resolve when STT done arrives
    });
  }

  /**
   * Run LLM with tool call handling.
   *
   * Key patterns to follow from createChatHandler.ts:
   * - Use streamText() from 'ai' package with createGroq provider
   * - buildSystemPrompt(config, siteConfig) for system message
   * - createBuiltinTools(siteConfig) returns { serverTools, clientTools }
   * - Server tools have an `execute` function — invoke inline
   * - Client tools have NO execute — send voice-agent.tool_call, wait for result
   * - Loop until LLM stops emitting tool calls (max 25 rounds)
   */
  private async runLlm(signal: AbortSignal): Promise<string> {
    const model = this.groq(this.opts.groqModel || 'openai/gpt-oss-120b');
    const systemPrompt = buildSystemPrompt(
      this.opts.siteConfig as any, // ClientState
      this.opts.siteConfig as any, // SiteConfig
    );
    const tools = createBuiltinTools(this.opts.siteConfig as any);

    let fullText = '';

    // Tool call loop
    while (this.roundTripCount < this.maxRoundTrips) {
      this.roundTripCount++;

      const result = streamText({
        model,
        system: systemPrompt,
        messages: this.conversation as any,
        tools,
        abortSignal: signal,
        maxSteps: 1, // One generation step, we handle tool loops ourselves
      });

      // Stream text deltas to client
      for await (const chunk of result.textStream) {
        fullText += chunk;
        this.opts.send(createEvent('response.text.delta', { delta: chunk }));
      }

      // Check for tool calls
      const response = await result.response;
      const toolCalls = response.messages?.filter(
        (m: any) => m.role === 'assistant' && m.content?.some?.((c: any) => c.type === 'tool-call')
      );

      if (!toolCalls?.length) break; // No more tool calls — done

      // Process each tool call
      for (const msg of toolCalls) {
        for (const content of (msg as any).content) {
          if (content.type !== 'tool-call') continue;

          const tool = tools[content.toolName];
          if (tool && 'execute' in tool) {
            // Server tool — execute inline
            const toolResult = await (tool as any).execute(content.args);
            this.conversation.push(
              { role: 'assistant', content: [content] },
              { role: 'tool', content: [{ type: 'tool-result', toolCallId: content.toolCallId, result: toolResult }] },
            );
          } else {
            // Client tool — send to browser, wait for result
            this.opts.send(createEvent('voice-agent.tool_call', {
              tool_call_id: content.toolCallId,
              name: content.toolName,
              arguments: content.args,
            }));

            const clientResult = await new Promise<unknown>((resolve, reject) => {
              this.pendingToolCalls.set(content.toolCallId, resolve);
              signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
              // Timeout: 30s for client to respond
              setTimeout(() => {
                if (this.pendingToolCalls.has(content.toolCallId)) {
                  this.pendingToolCalls.delete(content.toolCallId);
                  resolve({ error: 'Client tool call timed out' });
                }
              }, 30_000);
            });

            this.conversation.push(
              { role: 'assistant', content: [content] },
              { role: 'tool', content: [{ type: 'tool-result', toolCallId: content.toolCallId, result: clientResult }] },
            );
          }
        }
      }
    }

    // Add assistant message to conversation
    if (fullText.trim()) {
      const assistantMessage = { role: 'assistant', content: fullText };
      this.conversation.push(assistantMessage);
      this.opts.send(createEvent('response.text.done', { text: fullText }));
      this.opts.send(createEvent('conversation.item.created', { message: assistantMessage }));
    }

    return fullText;
  }

  /**
   * Stream TTS audio to client as binary WebSocket frames.
   *
   * Pattern from createTtsHandler.ts lines 329-358:
   * - Call synthesize() to get a streaming Response
   * - Read response.body with getReader()
   * - Forward each chunk as a binary WebSocket frame
   * - TTS providers return WAV with header — strip the 44-byte header before sending
   */
  private async runTts(text: string, signal: AbortSignal): Promise<void> {
    const response = await synthesize(text, this.opts.ttsConfig, signal);

    if (!response.ok) {
      console.error('[TTS] API error:', response.status);
      this.opts.send(createEvent('voice-agent.error', { code: 'tts_unavailable', message: 'TTS request failed' }));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    let headerStripped = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;

        let chunk = value;
        // Strip 44-byte WAV header from first chunk
        if (!headerStripped) {
          headerStripped = true;
          if (chunk.length > 44) {
            chunk = chunk.slice(44);
          } else {
            continue; // Header-only chunk, skip
          }
        }

        // Send raw PCM as binary WebSocket frame
        this.opts.sendBinary(Buffer.from(chunk));
      }
    } catch {
      reader.cancel().catch(() => {});
    } finally {
      this.opts.send(createEvent('response.audio.done', {}));
    }
  }
}
```

`cancel()` calls `this.turnAbort?.abort()`, which causes all in-flight awaits (`waitForSttDone`, `streamText`, `synthesize`) to reject with abort errors, caught by the try/catch in `startTurn`.

- [ ] **Step 3: Run tests**

```bash
cd packages/server && pnpm test
```

- [ ] **Step 4: Verify it compiles**

```bash
cd packages/server && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/voicePipeline.ts packages/server/src/__tests__/voicePipeline.test.ts
git commit -m "feat(server): add voice pipeline orchestrator (STT→LLM→TTS)"
```

---

### Task 8: WebSocket handler & attachVoicePipeline

**Files:**
- Create: `packages/server/src/createVoiceWebSocketHandler.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Implement createVoiceWebSocketHandler.ts**

This file:
- Accepts an `http.Server` and creates a `ws.WebSocketServer` on path `/api/voice`
- On each connection: creates a `VoicePipeline` instance, an `SttStreamClient` instance
- Routes incoming text frames via `parseEvent()` to pipeline methods
- Routes incoming binary frames (PCM audio) to `sttClient.sendAudio()`
- On `session.update`: stores conversation, config, language
- On `input_audio_buffer.commit`: calls `pipeline.startTurn()`
- On `response.cancel`: calls `pipeline.cancel()`
- On `voice-agent.tool_result`: resolves pending tool call promise in pipeline
- On close: cleans up pipeline and STT client

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { parseEvent, createEvent, isAudioFrame } from './protocol.js';
import { VoicePipeline } from './voicePipeline.js';
import { SttStreamClient } from './sttStreamClient.js';
import type { VoiceServerOptions } from './types.js';

export function createVoiceWebSocketHandler(server: HttpServer, options: VoiceServerOptions): void {
  const wss = new WebSocketServer({ server, path: '/api/voice' });

  wss.on('connection', (ws) => {
    const sessionId = crypto.randomUUID();

    const sttUrl = (options.kyutaiSttUrl || 'http://localhost:8003')
      .replace(/^http/, 'ws') + '/ws/transcribe';

    const sttClient = new SttStreamClient(sttUrl, {
      // callbacks wired to pipeline events
    });
    sttClient.connect();

    const pipeline = new VoicePipeline({
      sttClient,
      ttsConfig: { /* extract from options */ },
      groqApiKey: options.groqApiKey,
      groqModel: options.groqModel,
      send: (event) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(event);
      },
      sendBinary: (data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
      },
      siteConfig: options.config as Record<string, unknown>,
    });

    ws.send(createEvent('session.created', { session_id: sessionId }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Binary = PCM audio frame
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (isAudioFrame(buf)) {
          const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          sttClient.sendAudio(pcm);
        }
        return;
      }

      // Text = JSON event
      const event = parseEvent(data.toString());
      if (!event) return;

      switch (event.type) {
        case 'session.update':
          pipeline.setSession(event);
          break;
        case 'input_audio_buffer.commit':
          sttClient.flush();
          pipeline.startTurn();
          break;
        case 'input_audio_buffer.clear':
          sttClient.reset();
          break;
        case 'response.cancel':
          pipeline.cancel();
          sttClient.reset();
          break;
        case 'voice-agent.tool_result':
          pipeline.resolveToolCall(event.tool_call_id, event.result);
          break;
      }
    });

    ws.on('close', () => {
      pipeline.cancel();
      sttClient.close();
    });
  });
}
```

- [ ] **Step 2: Update index.ts with attachVoicePipeline**

First, create `packages/server/src/types.ts` to hold `VoiceServerOptions` (avoids circular import between `index.ts` ↔ `createVoiceWebSocketHandler.ts`):

```typescript
// packages/server/src/types.ts
import type { SiteConfig } from '@unctad-ai/voice-agent-core';

export interface VoiceServerOptions {
  config: SiteConfig;
  groqApiKey: string;
  groqModel?: string;
  sttProvider?: string;
  kyutaiSttUrl?: string;
  ttsProvider?: string;
  qwen3TtsUrl?: string;
  chatterboxTurboUrl?: string;
  cosyVoiceTtsUrl?: string;
  pocketTtsUrl?: string;
  resembleApiKey?: string;
  resembleModel?: string;
  resembleVoiceUuid?: string;
  personaDir?: string;
  ttsFallback?: boolean;
}
```

Then modify `packages/server/src/index.ts`:
- Import `VoiceServerOptions` from `./types.js` (not defined inline)
- Add `attachVoicePipeline` that wires both WebSocket handler AND persona routes
- Remove old exports

```typescript
import type { Server as HttpServer } from 'http';
import express from 'express';
import { createVoiceWebSocketHandler } from './createVoiceWebSocketHandler.js';
import { createPersonaRoutes } from './createPersonaRoutes.js';

export type { VoiceServerOptions } from './types.js';
import type { VoiceServerOptions } from './types.js';

/**
 * Attach the full voice pipeline to an HTTP server.
 * Sets up WebSocket at /api/voice and optionally persona routes at /api/agent.
 */
export function attachVoicePipeline(
  server: HttpServer,
  options: VoiceServerOptions,
  app?: express.Express,
): void {
  // WebSocket pipeline
  createVoiceWebSocketHandler(server, options);

  // Persona routes (avatar, voice management) — needs Express app to mount
  if (options.personaDir && app) {
    const { router } = createPersonaRoutes({
      personaDir: options.personaDir,
      ttsUpstreamUrl: options.qwen3TtsUrl,
    });
    app.use('/api/agent', router);
  }
}

export { createPersonaRoutes } from './createPersonaRoutes.js';
export { buildSystemPrompt } from './systemPrompt.js';
export { createBuiltinTools } from './builtinTools.js';
export { buildSynonymMap, fuzzySearch } from './builtinTools.js';
export type { ClientState } from './systemPrompt.js';
export type { PersonaRoutesOptions } from './createPersonaRoutes.js';
```

**Note:** `attachVoicePipeline` takes an optional `app` parameter for mounting persona routes. The consuming project migration becomes:
```typescript
const server = app.listen(3001);
attachVoicePipeline(server, options, app);
```

- [ ] **Step 3: Verify it compiles**

```bash
cd packages/server && pnpm build
```

- [ ] **Step 4: Run all server tests**

```bash
cd packages/server && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/createVoiceWebSocketHandler.ts packages/server/src/index.ts
git commit -m "feat(server): add WebSocket handler and attachVoicePipeline API"
```

---

## Chunk 4: Client Package Changes

Rewrite client hooks to use WebSocket. Preserve public API surface.

### Task 9: Client protocol types (`protocol/events.ts`)

**Files:**
- Create: `packages/core/src/protocol/events.ts`

- [ ] **Step 1: Create client-side event types**

Mirror the server's `protocol.ts` types for the client. These are the TypeScript interfaces the client uses to send/receive events. Keep them in sync with the server types but client-focused (e.g., `Message` type from the core package).

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/protocol/events.ts
git commit -m "feat(core): add WebSocket protocol event types"
```

---

### Task 10: WebSocket connection manager (`voiceWebSocket.ts`)

**Files:**
- Create: `packages/core/src/services/voiceWebSocket.ts`

- [ ] **Step 1: Implement voiceWebSocket.ts**

This module manages the browser WebSocket connection:
- `connect(url)` — opens WebSocket, sends `session.update` on open
- `sendAudio(pcm: Float32Array)` — sends binary frame
- `sendEvent(event)` — sends JSON text frame
- `onEvent(handler)` — register event handler
- `onAudio(handler)` — register binary audio handler
- `reconnect()` — exponential backoff (1s, 2s, 4s, max 30s)
- `close()` — teardown
- `checkHealth()` — ping/pong health check → returns `{ stt, llm, tts }` booleans

Binary/text disambiguation uses native WebSocket `MessageEvent.data` — if `data instanceof ArrayBuffer`, it's audio; otherwise it's a JSON event.

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/services/voiceWebSocket.ts
git commit -m "feat(core): add WebSocket connection manager"
```

---

### Task 11: Modify useTenVAD to expose raw audio frames

**Files:**
- Modify: `packages/core/src/hooks/useTenVAD.ts`

- [ ] **Step 1: Read current useTenVAD.ts**

Understand the existing `onFrameProcessed` callback and AudioWorklet flow.

- [ ] **Step 2: Add `onRawAudio` callback to UseTenVADOptions**

Add a new optional callback `onRawAudio?: (pcm: Float32Array) => void` that fires with the raw 256-sample PCM chunk from each VAD frame (16kHz, 16ms). This is distinct from `onFrameProcessed` which provides VAD probability results.

The implementer should find where the AudioWorklet's `message` event delivers PCM data (line ~388-392 of `useTenVAD.ts`, inside `worklet.port.onmessage`) and add the callback there, passing through the raw Float32Array before VAD processing.

**Ownership note:** `useTenVAD` fires raw 256-sample chunks at 16kHz. The **5-frame buffering + 16kHz→24kHz resampling** is owned by `useVoiceAgent.ts` (Task 14), NOT this hook. This hook just exposes the raw frames.

- [ ] **Step 3: Verify typecheck and build**

```bash
pnpm typecheck && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useTenVAD.ts
git commit -m "feat(core): expose raw audio frames from useTenVAD for WebSocket streaming"
```

---

### Task 12: Modify useAudioPlayback for WebSocket PCM

**Files:**
- Modify: `packages/core/src/hooks/useAudioPlayback.ts`

- [ ] **Step 1: Read current useAudioPlayback.ts**

Understand the current streaming flow (HTTP response body → ReadableStream → chunks → AudioBuffer).

- [ ] **Step 2: Add `playPcmChunk(pcm: ArrayBuffer, sampleRate: number)` method**

Add a new method alongside the existing `playStreamingAudio`. This method:
- Accepts raw PCM bytes (from WebSocket binary frame)
- Converts to Float32Array
- Creates AudioBuffer, schedules with sample-exact timing (same technique as existing code)
- Reuses the existing `scheduleStartTime` / `totalSamplesScheduled` tracking

The existing `playAudio` and `playStreamingAudio` methods stay for backward compatibility during transition but will be unused.

- [ ] **Step 3: Verify typecheck and build**

```bash
pnpm typecheck && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useAudioPlayback.ts
git commit -m "feat(core): add PCM chunk playback method for WebSocket audio"
```

---

### Task 13: Implement useVoiceWebSocket hook

**Files:**
- Create: `packages/core/src/hooks/useVoiceWebSocket.ts`

- [ ] **Step 1: Implement the main hook**

This is the core client hook that replaces `useChat` + HTTP pipeline:

```typescript
export interface UseVoiceWebSocketOptions {
  url: string;               // WebSocket URL (ws://host/api/voice)
  siteConfig: SiteConfig;
  voiceSettings: VoiceSettings;
  onToolCall?: (name: string, args: unknown) => Promise<unknown>;
  onStatusChange?: (status: string) => void;
}

export interface UseVoiceWebSocketReturn {
  status: 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
  messages: Message[];
  isConnected: boolean;
  sendAudio: (pcm: Float32Array) => void;
  commitAudio: () => void;
  cancelResponse: () => void;
  clearAudio: () => void;
}
```

Key behaviors:
- Opens WebSocket on mount, sends `session.update`
- `sendAudio` sends binary PCM frame
- `commitAudio` sends `input_audio_buffer.commit`
- `cancelResponse` sends `response.cancel`
- Handles `conversation.item.created` → appends to messages
- Handles `response.text.delta` → updates last assistant message
- Handles `voice-agent.tool_call` → calls `onToolCall`, sends result
- Handles `voice-agent.status` → updates status
- Handles `voice-agent.error` → updates status to error
- On reconnect after lost turn → injects "Sorry, I missed that" message

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/hooks/useVoiceWebSocket.ts
git commit -m "feat(core): add useVoiceWebSocket hook"
```

---

### Task 14: Rewrite useVoiceAgent internals

**Files:**
- Modify: `packages/core/src/hooks/useVoiceAgent.ts`

- [ ] **Step 1: Read current useVoiceAgent.ts thoroughly**

Understand the full return type, all state variables, the VAD→STT→LLM→TTS flow, barge-in, hallucination filtering, and pipeline timings.

- [ ] **Step 2: Rewrite using useVoiceWebSocket + useTenVAD + useAudioPlayback**

The hook must preserve its exact return type. Internally:
- Uses `useVoiceWebSocket` for WebSocket state and messages
- Uses `useTenVAD` with `onRawAudio` to stream PCM to WebSocket
- Uses `onSpeechEnd` to call `commitAudio()`
- Uses `useAudioPlayback` with `playPcmChunk` for WebSocket audio events
- Barge-in: on VAD speech during `speaking` status, calls `cancelResponse()` + suspends AudioContext
- Buffers 5 VAD frames (1280 samples at 16kHz), resamples to 24kHz (1920 samples) via OfflineAudioContext, sends as one Mimi frame
- Hallucination filtering now happens server-side (in voicePipeline.ts), but client can still check `voice-agent.stt_result` for display purposes
- Tool calls: wires `onToolCall` to the existing `createClientToolHandler` from `@unctad-ai/voice-agent-registries`

- [ ] **Step 3: Verify no residual imports from deleted modules**

```bash
# Must find ZERO matches — these modules will be deleted in Task 16
grep -r "voiceApi\|audioUtils\|wavParser\|useChat\|@ai-sdk/react" packages/core/src/hooks/ packages/core/src/services/ --include="*.ts" || echo "Clean — no residual imports"
```

- [ ] **Step 4: Verify typecheck and build**

```bash
pnpm typecheck && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hooks/useVoiceAgent.ts
git commit -m "feat(core): rewrite useVoiceAgent to use WebSocket pipeline"
```

---

## Chunk 5: Cleanup, Index Updates & Integration

Remove old files, update exports, update dependencies, verify everything builds.

### Task 15: Update core package exports and dependencies

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Update index.ts exports**

Remove:
```typescript
export * from './services/voiceApi';
export { float32ToWav } from './utils/audioUtils';
export { parseWavHeader, pcmToFloat32 } from './utils/wavParser';
export type { WavHeader } from './utils/wavParser';
```

Add:
```typescript
export { checkPipelineHealth } from './services/voiceWebSocket';
export * from './protocol/events';
```

- [ ] **Step 2: Remove @ai-sdk/react peer dependency from package.json**

In `packages/core/package.json`, remove `"@ai-sdk/react"` from both `peerDependencies` and `devDependencies`.

**Note:** Keep the `ai` peer dependency if `Message` or other types are still imported from it. Check `useVoiceWebSocket.ts` and `useVoiceAgent.ts` — if they use `Message` type from `ai`, keep it. If we've replaced it with our own type in `protocol/events.ts`, remove it too.

- [ ] **Step 3: Run pnpm install to update lockfile**

```bash
pnpm install
```

- [ ] **Step 4: Verify typecheck and build**

```bash
pnpm typecheck && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): update exports — remove HTTP APIs, add WebSocket protocol"
```

---

### Task 16: Remove old files

**Files:**
- Delete: `packages/server/src/createSttHandler.ts`
- Delete: `packages/server/src/createTtsHandler.ts`
- Delete: `packages/server/src/createChatHandler.ts`
- Delete: `packages/core/src/services/voiceApi.ts`
- Delete: `packages/core/src/utils/audioUtils.ts`
- Delete: `packages/core/src/utils/wavParser.ts`

- [ ] **Step 1: Remove old server handlers**

```bash
git rm packages/server/src/createSttHandler.ts
git rm packages/server/src/createTtsHandler.ts
git rm packages/server/src/createChatHandler.ts
```

- [ ] **Step 2: Remove old client HTTP wrappers and audio utilities**

```bash
git rm packages/core/src/services/voiceApi.ts
git rm packages/core/src/utils/audioUtils.ts
git rm packages/core/src/utils/wavParser.ts
```

- [ ] **Step 3: Verify typecheck and build still pass**

```bash
pnpm typecheck && pnpm build
```

If there are remaining references to deleted files, fix them. Common places to check:
- Other files importing from deleted modules
- Test files referencing old functions

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore: remove old HTTP REST handlers and audio utilities"
```

---

### Task 17: Full build verification and changeset

- [ ] **Step 1: Clean build from scratch**

```bash
pnpm install && pnpm build && pnpm typecheck
```
All must pass.

- [ ] **Step 2: Run all tests**

```bash
cd packages/server && pnpm test
```
All must pass.

- [ ] **Step 3: Create changeset**

```bash
pnpm changeset
```

Select all 4 packages. This is a **major** version bump (breaking change — REST endpoints removed).

Changeset description:
```
Replace HTTP REST voice pipeline with WebSocket.

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
```

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for WebSocket voice pipeline (major)"
```

---

### Task 18: Integration test with GPU server

This task requires access to the GPU server. Test the full pipeline end-to-end.

- [ ] **Step 1: Deploy updated STT server to GPU**

```bash
ssh gpu-server "cd ~/kyutai-stt && git pull && docker compose up --build -d"
```

- [ ] **Step 2: Test STT WebSocket endpoint**

```bash
# Quick connectivity test from local machine
ssh gpu-server "python3 -c \"
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:8003/ws/transcribe') as ws:
        ws.send(json.dumps({'type': 'reset'}))
        print('STT WebSocket: OK')
asyncio.run(test())
\""
```

- [ ] **Step 3: Start local dev server and test in browser**

```bash
pnpm dev
```

Open browser, verify:
- WebSocket connects to `/api/voice`
- Speaking produces transcript
- LLM responds
- TTS audio plays back
- Barge-in works
- Tool calls work (navigate, form fill)

- [ ] **Step 4: Test reconnection**

Kill and restart the Express server. Verify:
- Client reconnects automatically
- "Sorry, I missed that" message appears if turn was in-flight
- Subsequent turns work normally

- [ ] **Step 5: Document any issues found**

Create a file at `docs/superpowers/specs/2026-03-14-websocket-integration-notes.md` with any findings, adjustments needed, or deviations from spec.
