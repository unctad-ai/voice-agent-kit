# WebSocket Voice Pipeline Hardening

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the WebSocket voice pipeline with proper state machines, async queuing, turn boundaries, echo protection, audio buffering, and error propagation — making it reliable for production.

**Architecture:** Six independent hardening tasks across the server (`packages/server`) and client (`packages/core`) packages. Server-side changes are fully TDD with vitest. Client-side changes use the same patterns but are verified in-browser since core doesn't have a test runner. Each task produces a standalone commit.

**Tech Stack:** TypeScript, vitest (server tests), WebSocket (ws on server, native on client), Web Audio API (client playback)

**Audio format chain (reference):**
```
Browser mic → Float32, 16kHz, 256 samples/frame (VAD hop)
  ↓ buffer 5 frames, resample via OfflineAudioContext
Client → Server WS → Float32 binary, 24kHz, 1920 samples/frame
  ↓ forward to STT
Server → STT WS → Float32 binary, 24kHz, 1920 samples
  ↓ inference
STT → Server → JSON events (word, vad, done)
  ↓ LLM call
Server → TTS HTTP → text string
  ↓ synthesis
TTS → Server HTTP → Int16 PCM WAV (24kHz, 16-bit, mono, 44-byte header)
  ↓ strip header
Server → Client WS → Int16 PCM binary (no header)
  ↓ convert
Client playback → Int16→Float32 conversion → AudioBufferSourceNode
```

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `packages/server/src/wsState.ts` | `WsState` enum (CONNECTING, OPEN, CLOSING, CLOSED) + guard helpers |
| `packages/server/src/asyncQueue.ts` | Generic `AsyncQueue<T>` with put/take/cancel semantics |
| `packages/core/src/utils/pcmBufferQueue.ts` | PCM chunk buffer queue — accumulates N chunks before scheduling |
| `packages/server/src/__tests__/wsState.test.ts` | Tests for state machine guards |
| `packages/server/src/__tests__/sttStreamClient.test.ts` | Tests for SttStreamClient state transitions |
| `packages/server/src/__tests__/asyncQueue.test.ts` | Tests for AsyncQueue put/take/cancel |

### Modified files
| File | Changes |
|------|---------|
| `packages/server/src/sttStreamClient.ts` | Add WsState tracking, guard all ops |
| `packages/core/src/services/voiceWebSocket.ts` | Add state tracking, guard all ops |
| `packages/server/src/voicePipeline.ts` | Replace sttDoneResolve with AsyncQueue, wrap async calls |
| `packages/server/src/createVoiceWebSocketHandler.ts` | Add turn state, ignore audio during processing, error handling |
| `packages/core/src/hooks/useVoiceAgent.ts` | Stop sending audio after commit, add uninterruptible window |
| `packages/core/src/hooks/useAudioPlayback.ts` | Buffer N chunks before scheduling playback |
| `packages/core/src/config/defaults.ts` | Add `UNINTERRUPTIBLE_WINDOW_MS` constant |

---

## Chunk 1: Server-side hardening (Tasks 1-3, 6)

### Task 1: WebSocket State Machine

#### 1A: Create WsState enum and guards

**Files:**
- Create: `packages/server/src/wsState.ts`
- Create: `packages/server/src/__tests__/wsState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/wsState.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WsState, canSend, canClose, transitionTo } from '../wsState.js';

describe('WsState', () => {
  it('canSend is true only in OPEN state', () => {
    expect(canSend(WsState.CONNECTING)).toBe(false);
    expect(canSend(WsState.OPEN)).toBe(true);
    expect(canSend(WsState.CLOSING)).toBe(false);
    expect(canSend(WsState.CLOSED)).toBe(false);
  });

  it('canClose is true in CONNECTING and OPEN states', () => {
    expect(canClose(WsState.CONNECTING)).toBe(true);
    expect(canClose(WsState.OPEN)).toBe(true);
    expect(canClose(WsState.CLOSING)).toBe(false);
    expect(canClose(WsState.CLOSED)).toBe(false);
  });

  it('transitionTo validates allowed transitions', () => {
    expect(transitionTo(WsState.CONNECTING, WsState.OPEN)).toBe(WsState.OPEN);
    expect(transitionTo(WsState.CONNECTING, WsState.CLOSED)).toBe(WsState.CLOSED);
    expect(transitionTo(WsState.OPEN, WsState.CLOSING)).toBe(WsState.CLOSING);
    expect(transitionTo(WsState.CLOSING, WsState.CLOSED)).toBe(WsState.CLOSED);
    // Invalid: CLOSED -> OPEN
    expect(transitionTo(WsState.CLOSED, WsState.OPEN)).toBe(WsState.CLOSED);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/wsState.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WsState**

Create `packages/server/src/wsState.ts`:

```typescript
/**
 * WebSocket connection state machine.
 * Guards all send/close operations to prevent crashes on invalid states.
 */
export enum WsState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

/** Valid state transitions */
const TRANSITIONS: Record<WsState, Set<WsState>> = {
  [WsState.CONNECTING]: new Set([WsState.OPEN, WsState.CLOSED]),
  [WsState.OPEN]: new Set([WsState.CLOSING, WsState.CLOSED]),
  [WsState.CLOSING]: new Set([WsState.CLOSED]),
  [WsState.CLOSED]: new Set(),
};

/** Returns true if data can be sent (only in OPEN state). */
export function canSend(state: WsState): boolean {
  return state === WsState.OPEN;
}

/** Returns true if the connection can be closed (CONNECTING or OPEN). */
export function canClose(state: WsState): boolean {
  return state === WsState.CONNECTING || state === WsState.OPEN;
}

/**
 * Attempt a state transition. Returns the new state if valid,
 * or the current state if the transition is not allowed.
 */
export function transitionTo(current: WsState, target: WsState): WsState {
  return TRANSITIONS[current].has(target) ? target : current;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/wsState.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/wsState.ts packages/server/src/__tests__/wsState.test.ts
git commit -m "feat(server): add WebSocket state machine enum and guards"
```

#### 1B: Apply state machine to SttStreamClient

**Files:**
- Modify: `packages/server/src/sttStreamClient.ts`
- Create: `packages/server/src/__tests__/sttStreamClient.test.ts`

- [ ] **Step 6: Write the failing test**

Create `packages/server/src/__tests__/sttStreamClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SttStreamClient } from '../sttStreamClient.js';
import { WsState } from '../wsState.js';

// Mock the ws module
vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const listeners = new Map<string, Function[]>();
    return {
      readyState: 1, // OPEN
      binaryType: 'arraybuffer',
      on: vi.fn((event: string, handler: Function) => {
        const existing = listeners.get(event) || [];
        existing.push(handler);
        listeners.set(event, existing);
      }),
      send: vi.fn(),
      close: vi.fn(),
      removeAllListeners: vi.fn(),
      _trigger: (event: string, ...args: unknown[]) => {
        for (const handler of listeners.get(event) || []) handler(...args);
      },
    };
  });
  (MockWebSocket as any).OPEN = 1;
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

describe('SttStreamClient state machine', () => {
  let client: SttStreamClient;
  let callbacks: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    callbacks = {
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    };
    client = new SttStreamClient('ws://localhost:8003/ws/transcribe', callbacks);
  });

  afterEach(() => {
    client.close();
  });

  it('starts in CLOSED state', () => {
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('transitions to CONNECTING on connect()', () => {
    client.connect();
    expect(client.state).toBe(WsState.CONNECTING);
  });

  it('sendAudio is a no-op when not OPEN', () => {
    const pcm = new Float32Array(1920);
    // Should not throw
    client.sendAudio(pcm);
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('flush is a no-op when not OPEN', () => {
    client.flush();
    // Should not throw
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('close() transitions to CLOSED and clears reconnect', () => {
    client.connect();
    client.close();
    expect(client.state).toBe(WsState.CLOSED);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/sttStreamClient.test.ts`
Expected: FAIL — `client.state` property doesn't exist

- [ ] **Step 8: Implement state machine in SttStreamClient**

Modify `packages/server/src/sttStreamClient.ts` — add these changes:

1. Import `WsState, canSend, canClose, transitionTo` from `./wsState.js`
2. Add `private _state: WsState = WsState.CLOSED` field
3. Add `get state(): WsState { return this._state; }` public getter
4. In `connect()`: set `this._state = WsState.CONNECTING`
5. In `ws.on('open')`: set `this._state = transitionTo(this._state, WsState.OPEN)`
6. In `ws.on('close')`: set `this._state = transitionTo(this._state, WsState.CLOSED)`
7. In `sendAudio()`: replace `if (this.ws?.readyState !== WebSocket.OPEN)` with `if (!canSend(this._state))`
8. In `flush()`: same guard replacement
9. In `reset()`: same guard replacement
10. In `close()`: set `this._state = WsState.CLOSED`
11. Update `isConnected` getter to use `this._state === WsState.OPEN`

Remove the `closed` boolean field — the state machine replaces it.

- [ ] **Step 9: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/sttStreamClient.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 10: Run all existing tests to verify no regression**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/sttStreamClient.ts packages/server/src/__tests__/sttStreamClient.test.ts
git commit -m "feat(server): add state machine to SttStreamClient"
```

#### 1C: Apply state machine to VoiceWebSocketManager (client)

**Files:**
- Modify: `packages/core/src/services/voiceWebSocket.ts`

- [ ] **Step 12: Implement state machine in VoiceWebSocketManager**

Since the client uses native browser `WebSocket` (not the `ws` package), implement a parallel enum directly in the file:

1. Add enum at top of file:
```typescript
enum WsState { CONNECTING, OPEN, CLOSING, CLOSED }
```

2. Add `private state: WsState = WsState.CLOSED` field
3. In `_open()`: set `this.state = WsState.CONNECTING` before `new WebSocket()`
4. In `ws.onopen`: set `this.state = WsState.OPEN`
5. In `ws.onclose`: set `this.state = WsState.CLOSED`
6. In `sendAudio()`: replace readyState check with `if (this.state !== WsState.OPEN)` — remove try/catch
7. In `sendEvent()`: same guard
8. In `close()`: set `this.state = WsState.CLOSED`
9. Update `isConnected` getter to use `this.state === WsState.OPEN`

- [ ] **Step 13: Typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 14: Commit**

```bash
git add packages/core/src/services/voiceWebSocket.ts
git commit -m "feat(core): add state machine to VoiceWebSocketManager"
```

---

### Task 2: AsyncQueue for STT Results

**Files:**
- Create: `packages/server/src/asyncQueue.ts`
- Create: `packages/server/src/__tests__/asyncQueue.test.ts`
- Modify: `packages/server/src/voicePipeline.ts`

- [ ] **Step 15: Write the failing test**

Create `packages/server/src/__tests__/asyncQueue.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AsyncQueue } from '../asyncQueue.js';

describe('AsyncQueue', () => {
  it('take() resolves when put() is called after', async () => {
    const q = new AsyncQueue<string>();
    const promise = q.take();
    q.put('hello');
    expect(await promise).toBe('hello');
  });

  it('take() resolves immediately if item was put() before', async () => {
    const q = new AsyncQueue<string>();
    q.put('buffered');
    expect(await q.take()).toBe('buffered');
  });

  it('multiple put/take pairs resolve in order (FIFO)', async () => {
    const q = new AsyncQueue<number>();
    q.put(1);
    q.put(2);
    q.put(3);
    expect(await q.take()).toBe(1);
    expect(await q.take()).toBe(2);
    expect(await q.take()).toBe(3);
  });

  it('cancel() rejects pending take()', async () => {
    const q = new AsyncQueue<string>();
    const promise = q.take();
    q.cancel();
    await expect(promise).rejects.toThrow('cancelled');
  });

  it('cancel() discards buffered items', () => {
    const q = new AsyncQueue<string>();
    q.put('a');
    q.put('b');
    q.cancel();
    // After cancel, a new take should hang (not resolve with old items)
    const promise = q.take();
    q.put('fresh');
    return expect(promise).resolves.toBe('fresh');
  });

  it('take() with AbortSignal rejects on abort', async () => {
    const q = new AsyncQueue<string>();
    const controller = new AbortController();
    const promise = q.take(controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
  });
});
```

- [ ] **Step 16: Run test to verify it fails**

Run: `cd packages/server && npx vitest run src/__tests__/asyncQueue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 17: Implement AsyncQueue**

Create `packages/server/src/asyncQueue.ts`:

```typescript
/**
 * A simple async FIFO queue with cancellation support.
 * Inspired by Unmute's QuestManager pattern.
 *
 * - put(item): enqueue an item (resolves a waiting take, or buffers)
 * - take(signal?): dequeue an item (waits if empty, abortable)
 * - cancel(): reject all pending takes and clear the buffer
 */
export class AsyncQueue<T> {
  private buffer: T[] = [];
  private waiters: Array<{
    resolve: (value: T) => void;
    reject: (reason: Error) => void;
  }> = [];

  /** Enqueue an item. If a consumer is waiting, deliver directly. */
  put(item: T): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve(item);
    } else {
      this.buffer.push(item);
    }
  }

  /** Dequeue an item. Waits if the buffer is empty. */
  take(signal?: AbortSignal): Promise<T> {
    if (this.buffer.length > 0) {
      return Promise.resolve(this.buffer.shift()!);
    }

    return new Promise<T>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);

      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
          reject(new Error('cancelled'));
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Reject all pending takes and clear the buffer. */
  cancel(): void {
    for (const waiter of this.waiters) {
      waiter.reject(new Error('cancelled'));
    }
    this.waiters = [];
    this.buffer = [];
  }
}
```

- [ ] **Step 18: Run test to verify it passes**

Run: `cd packages/server && npx vitest run src/__tests__/asyncQueue.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 19: Commit**

```bash
git add packages/server/src/asyncQueue.ts packages/server/src/__tests__/asyncQueue.test.ts
git commit -m "feat(server): add AsyncQueue for producer/consumer coordination"
```

- [ ] **Step 20: Integrate AsyncQueue into VoicePipeline**

Modify `packages/server/src/voicePipeline.ts`:

1. Import `AsyncQueue` from `./asyncQueue.js`
2. Replace the three STT-related fields:
   ```typescript
   // REMOVE these:
   private sttDoneResolve: ((result: SttDoneResult) => void) | null = null;
   private bufferedSttDone: SttDoneResult | null = null;

   // ADD this:
   private sttQueue = new AsyncQueue<SttDoneResult>();
   ```

3. Replace `resolveSttDone()`:
   ```typescript
   resolveSttDone(text: string, vadProbs: number[], durationMs: number): void {
     this.sttQueue.put({ text, vadProbs, durationMs });
   }
   ```

4. Replace `waitForSttDone()`:
   ```typescript
   private waitForSttDone(signal: AbortSignal): Promise<SttDoneResult> {
     return this.sttQueue.take(signal);
   }
   ```

5. In `cancel()`, replace STT cleanup:
   ```typescript
   // REMOVE:
   this.sttDoneResolve = null;
   this.bufferedSttDone = null;

   // ADD:
   this.sttQueue.cancel();
   ```

- [ ] **Step 21: Run all server tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass

- [ ] **Step 22: Typecheck both packages**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 23: Commit**

```bash
git add packages/server/src/voicePipeline.ts
git commit -m "refactor(server): replace sttDoneResolve with AsyncQueue"
```

---

### Task 3: Turn Boundary Protocol

**Files:**
- Modify: `packages/server/src/createVoiceWebSocketHandler.ts`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts`

- [ ] **Step 24: Add turn state to server WebSocket handler**

Modify `packages/server/src/createVoiceWebSocketHandler.ts`:

1. Add a `processingTurn` boolean to the connection scope (after `let pipeline`):
   ```typescript
   let processingTurn = false;
   ```

2. In the `input_audio_buffer.commit` handler, set it to `true`:
   ```typescript
   case 'input_audio_buffer.commit':
     pipeline.cancel();
     sttClient.flush();
     processingTurn = true;
     pipeline.startTurn().catch((err) => {
       console.error('[WS] startTurn error:', err);
     }).finally(() => {
       processingTurn = false;
     });
     break;
   ```

3. In the binary message handler, skip forwarding audio when processing:
   ```typescript
   if (isBinary) {
     const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
     if (isAudioFrame(buf)) {
       audioFrameCount++;
       // Ignore audio frames during turn processing
       if (processingTurn) {
         if (audioFrameCount % 100 === 0) {
           console.log(`[WS] Ignoring audio frame #${audioFrameCount} (turn in progress)`);
         }
         return;
       }
       const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
       sttClient.sendAudio(pcm);
       if (audioFrameCount <= 3 || audioFrameCount % 50 === 0) {
         console.log(`[WS] audio frame #${audioFrameCount} samples=${pcm.length} sttConnected=${sttClient.isConnected}`);
       }
     }
     return;
   }
   ```

- [ ] **Step 25: Add turn boundary to client**

Modify `packages/core/src/hooks/useVoiceAgent.ts`:

In `handleRawAudio`, add an early return when not in a state that should send audio:

```typescript
const handleRawAudio = useCallback(
  (pcm: Float32Array) => {
    // Only send audio when LISTENING or USER_SPEAKING
    if (stateRef.current !== 'LISTENING' && stateRef.current !== 'USER_SPEAKING') return;
    // ... rest of existing code
  },
  [voiceWs],
);
```

This replaces the existing `if (stateRef.current === 'IDLE') return;` check — which was too permissive (allowed audio during PROCESSING and AI_SPEAKING).

- [ ] **Step 26: Typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 27: Commit**

```bash
git add packages/server/src/createVoiceWebSocketHandler.ts packages/core/src/hooks/useVoiceAgent.ts
git commit -m "feat: add turn boundary protocol — stop audio during processing"
```

---

### Task 6: Error Propagation

**Files:**
- Modify: `packages/server/src/voicePipeline.ts`
- Modify: `packages/server/src/createVoiceWebSocketHandler.ts`
- Modify: `packages/core/src/services/voiceWebSocket.ts`

- [ ] **Step 28: Audit and wrap async calls in VoicePipeline**

In `packages/server/src/voicePipeline.ts`:

1. The `streamTtsAudio` call is already inside the try/catch of `startTurn()` — good.
2. The `streamText` call is inside `runLlmLoop` — needs wrapping for each `toolDef.execute()`:

Already has try/catch around `toolDef.execute()` — good.

3. The `waitForClientToolResult` timeout already handles cleanup — good.

4. Add error handling for the `result.response` await in `runLlmLoop()`:
```typescript
// In runLlmLoop, wrap the response await:
let response;
try {
  response = await result.response;
} catch (err) {
  if (signal.aborted) throw new Error('cancelled');
  console.error('[voice-pipeline] LLM stream error:', err);
  throw err;
}
```

- [ ] **Step 29: Add error wrapping to WebSocket handler**

In `packages/server/src/createVoiceWebSocketHandler.ts`:

1. Wrap the `pipeline.startTurn()` call more defensively:
```typescript
case 'input_audio_buffer.commit':
  pipeline.cancel();
  sttClient.flush();
  processingTurn = true;
  pipeline.startTurn()
    .catch((err) => {
      if (err?.message !== 'cancelled') {
        console.error('[WS] startTurn error:', err);
        safeSend(createEvent('error', { code: 'pipeline_error', message: err?.message || 'Unknown error' }));
        safeSend(createEvent('status', { status: 'listening' }));
      }
    })
    .finally(() => {
      processingTurn = false;
    });
  break;
```

2. Add `ws.on('error')` handler:
```typescript
ws.on('error', (err) => {
  console.error(`[WS] Connection error for session ${sessionId}:`, err);
});
```

- [ ] **Step 30: Guard sends in VoiceWebSocketManager**

In `packages/core/src/services/voiceWebSocket.ts`, `sendEvent()` already checks readyState. With the state machine from Task 1C, this is covered. No additional changes needed.

- [ ] **Step 31: Typecheck and test**

Run: `pnpm typecheck && cd packages/server && npx vitest run`
Expected: All pass

- [ ] **Step 32: Commit**

```bash
git add packages/server/src/voicePipeline.ts packages/server/src/createVoiceWebSocketHandler.ts
git commit -m "fix(server): wrap all async pipeline calls with proper error propagation"
```

---

## Chunk 2: Client-side hardening (Tasks 4-5)

### Task 4: Uninterruptible Window

**Files:**
- Modify: `packages/core/src/config/defaults.ts`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts`

- [ ] **Step 33: Add constant**

In `packages/core/src/config/defaults.ts`, add after the BARGE_IN section:

```typescript
/**
 * Time in ms after bot starts speaking during which VAD barge-in is suppressed.
 * Prevents echo-cancellation false triggers from TTS playback being picked up
 * by the mic. Inspired by Unmute's UNINTERRUPTIBLE_BY_VAD_TIME_SEC.
 */
export const UNINTERRUPTIBLE_WINDOW_MS = 3000;
```

- [ ] **Step 34: Implement uninterruptible window in useVoiceAgent**

In `packages/core/src/hooks/useVoiceAgent.ts`:

1. Import the new constant:
```typescript
import {
  // ... existing imports
  UNINTERRUPTIBLE_WINDOW_MS,
} from '../config/defaults';
```

2. Add a ref to track when AI started speaking (near the other refs):
```typescript
const aiSpeakingStartRef = useRef(0);
```

3. In the `onAudio` callback, record the timestamp on first audio chunk:
```typescript
onAudio: (data: ArrayBuffer) => {
  if (stateRef.current === 'PROCESSING') {
    resetPcmSchedule();
    stateRef.current = 'AI_SPEAKING';
    setState('AI_SPEAKING');
    aiSpeakingStartRef.current = Date.now();  // <-- ADD THIS
  }
  if (stateRef.current === 'AI_SPEAKING') {
    playPcmChunk(data, TARGET_RATE);
  }
},
```

4. In `onFrameProcessed` (the VAD callback), add the uninterruptible guard:
```typescript
onFrameProcessed: (probabilities) => {
  if (bargeInEnabled && stateRef.current === 'AI_SPEAKING') {
    // Uninterruptible window: suppress barge-in for first N ms after TTS starts
    const elapsed = Date.now() - aiSpeakingStartRef.current;
    if (elapsed < UNINTERRUPTIBLE_WINDOW_MS) return;

    if (
      probabilities.isSpeech > settings.bargeInThreshold &&
      probabilities.rms >= settings.minAudioRms
    ) {
      // ... existing barge-in logic
    }
  }
},
```

- [ ] **Step 35: Typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 36: Commit**

```bash
git add packages/core/src/config/defaults.ts packages/core/src/hooks/useVoiceAgent.ts
git commit -m "feat(core): add 3s uninterruptible window after TTS starts"
```

---

### Task 5: Audio Buffering for Playback

**Files:**
- Create: `packages/core/src/utils/pcmBufferQueue.ts`
- Modify: `packages/core/src/hooks/useAudioPlayback.ts`

- [ ] **Step 37: Create PcmBufferQueue**

Create `packages/core/src/utils/pcmBufferQueue.ts`:

```typescript
/**
 * Buffer queue for PCM audio chunks.
 * Accumulates chunks until a minimum buffer threshold is reached,
 * then flushes them for scheduling. This prevents choppy playback
 * from scheduling tiny chunks individually.
 *
 * Inspired by Unmute's RealtimeQueue pattern.
 */

const DEFAULT_MIN_BUFFER_CHUNKS = 4;

export class PcmBufferQueue {
  private buffer: ArrayBuffer[] = [];
  private flushed = false;
  private minChunks: number;

  constructor(minChunks = DEFAULT_MIN_BUFFER_CHUNKS) {
    this.minChunks = minChunks;
  }

  /**
   * Add a chunk to the buffer.
   * Returns chunks to schedule (empty array if still buffering).
   */
  push(chunk: ArrayBuffer): ArrayBuffer[] {
    this.buffer.push(chunk);

    // Once we've hit the threshold, flush immediately on every push
    if (this.flushed) {
      return [this.buffer.pop()!];
    }

    // Initial buffering: wait for minChunks
    if (this.buffer.length >= this.minChunks) {
      this.flushed = true;
      const chunks = this.buffer;
      this.buffer = [];
      return chunks;
    }

    return [];
  }

  /** Reset for a new response. */
  reset(): void {
    this.buffer = [];
    this.flushed = false;
  }

  /** Flush any remaining buffered chunks (e.g. at end of response). */
  flush(): ArrayBuffer[] {
    const chunks = this.buffer;
    this.buffer = [];
    this.flushed = false;
    return chunks;
  }
}
```

- [ ] **Step 38: Integrate PcmBufferQueue into useAudioPlayback**

Modify `packages/core/src/hooks/useAudioPlayback.ts`:

1. Import at top:
```typescript
import { PcmBufferQueue } from '../utils/pcmBufferQueue';
```

2. Add ref inside the hook (near `pcmFirstChunkRef`):
```typescript
const pcmBufferQueueRef = useRef(new PcmBufferQueue());
```

3. In `resetPcmSchedule()`, also reset the buffer queue:
```typescript
const resetPcmSchedule = useCallback(() => {
  pcmScheduleStartRef.current = 0;
  pcmTotalSamplesRef.current = 0;
  pcmNextTimeRef.current = 0;
  pcmFirstChunkRef.current = true;
  pcmBufferQueueRef.current.reset();
}, []);
```

4. Modify `playPcmChunk` to buffer through the queue:

Replace the entire `playPcmChunk` callback body with:

```typescript
const playPcmChunk = useCallback(
  (pcm: ArrayBuffer, sampleRate: number): void => {
    const ctx = getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const chunksToSchedule = pcmBufferQueueRef.current.push(pcm);
    if (chunksToSchedule.length === 0) return; // still buffering

    for (const chunk of chunksToSchedule) {
      // TTS sends 16-bit Int16 PCM — convert to Float32 [-1, 1]
      const int16 = new Int16Array(chunk);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      if (speedRef) source.playbackRate.value = speedRef.current;
      source.connect(gainRef.current!);
      streamingSourcesRef.current.push(source);

      source.onended = () => {
        const idx = streamingSourcesRef.current.indexOf(source);
        if (idx !== -1) streamingSourcesRef.current.splice(idx, 1);
      };

      if (pcmFirstChunkRef.current) {
        pcmScheduleStartRef.current = ctx.currentTime + 0.025;
        pcmNextTimeRef.current = pcmScheduleStartRef.current;
        pcmTotalSamplesRef.current = 0;
        pcmFirstChunkRef.current = false;
      }

      source.start(pcmNextTimeRef.current);
      pcmTotalSamplesRef.current += float32.length;
      const effectiveSpeed = speedRef?.current ?? 1;
      pcmNextTimeRef.current =
        pcmScheduleStartRef.current +
        pcmTotalSamplesRef.current / (sampleRate * effectiveSpeed);
    }
  },
  [getContext, speedRef],
);
```

- [ ] **Step 39: Typecheck**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 40: Commit**

```bash
git add packages/core/src/utils/pcmBufferQueue.ts packages/core/src/hooks/useAudioPlayback.ts
git commit -m "feat(core): add PCM buffer queue for smoother audio playback"
```

---

## Final Verification

- [ ] **Step 41: Build all packages**

Run: `pnpm build`
Expected: All 4 packages build successfully

- [ ] **Step 42: Typecheck all packages**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 43: Run all tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass (existing + new: wsState, sttStreamClient, asyncQueue, voicePipeline)

- [ ] **Step 44: Manual browser verification**

Start the local dev environment:
```bash
# Terminal 1:
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya/server && npx tsx --env-file=.env index.ts

# Terminal 2:
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya && npx vite
```

Verify:
1. Voice loop: speak -> transcript -> LLM responds -> TTS plays -> returns to listening
2. No "Processing" stuck state
3. Clean audio playback (no clicks or pops)
4. Connect/disconnect cycles don't crash server
5. Barge-in works after 3s uninterruptible window

- [ ] **Step 45: Release (only after all verification passes)**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit
pnpm changeset  # Describe: "WebSocket pipeline hardening: state machines, async queue, turn boundaries, echo guard, audio buffering, error propagation"
git add . && git commit -m "chore: add changeset for WebSocket hardening"
./scripts/release.sh --yes
cd ../singlewindow-deployments && ./scripts/update-all.sh
```
