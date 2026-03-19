# Voice Recording for Persona Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-browser audio recording as a first-class alternative to WAV file upload in the persona settings voice section.

**Architecture:** New `useVoiceRecorder` hook wraps existing `useTenVAD` to capture raw PCM via `onRawAudio`, accumulate chunks, and encode to WAV client-side. A new `RecordingFlow` component in `PersonaSettings.tsx` renders the 3-state inline UI (ready → recording → review). Server duration limit bumped from 30s to 45s.

**Tech Stack:** React hooks, useTenVAD (existing), vitest, inline styles (matching PersonaSettings patterns)

**Spec:** `docs/superpowers/specs/2026-03-18-voice-recording-design.md`

---

## File Structure

| File | Role |
|---|---|
| `packages/core/src/hooks/useVoiceRecorder.ts` | **New** — Hook: state machine, PCM accumulation via useTenVAD's onRawAudio, WAV encoding, quality checks, timer |
| `packages/core/src/hooks/wavEncoder.ts` | **New** — Pure function: Float32 PCM @ 16kHz mono → WAV Blob. Separated for testability |
| `packages/core/src/__tests__/wavEncoder.test.ts` | **New** — Unit tests for WAV encoding |
| `packages/core/src/__tests__/useVoiceRecorder.test.ts` | **New** — Unit tests for recorder state machine and quality checks |
| `packages/core/src/index.ts` | **Modify** — Export `useVoiceRecorder` and its types |
| `packages/ui/src/components/PersonaSettings.tsx` | **Modify** — Split UploadButton into two buttons, add RecordingFlow component |
| `packages/server/src/createPersonaRoutes.ts` | **Modify** — One line: `30` → `45` in duration check + error message |

---

## Task 1: WAV Encoder

Pure function, no dependencies, fully testable.

**Files:**
- Create: `packages/core/src/hooks/wavEncoder.ts`
- Create: `packages/core/src/__tests__/wavEncoder.test.ts`

- [ ] **Step 1: Write failing tests for WAV encoder**

```typescript
// packages/core/src/__tests__/wavEncoder.test.ts
import { describe, it, expect } from 'vitest';
import { encodeWav, checkQuality } from '../hooks/wavEncoder';

describe('encodeWav', () => {
  it('produces a valid WAV blob from Float32 PCM', () => {
    // 1 second of silence at 16kHz
    const pcm = new Float32Array(16000);
    const blob = encodeWav(pcm, 16000);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/wav');
    // WAV header (44 bytes) + 16000 samples × 2 bytes (Int16)
    expect(blob.size).toBe(44 + 16000 * 2);
  });

  it('encodes non-zero samples correctly', async () => {
    // Short buffer with a known value
    const pcm = new Float32Array([0.5, -0.5, 1.0, -1.0]);
    const blob = encodeWav(pcm, 16000);
    const buf = new Uint8Array(await blob.arrayBuffer());

    // Check RIFF header
    const header = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    expect(header).toBe('RIFF');

    // Check WAVE format
    const format = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    expect(format).toBe('WAVE');

    // Check sample rate at offset 24 (little-endian uint32)
    const sampleRate = buf[24] | (buf[25] << 8) | (buf[26] << 16) | (buf[27] << 24);
    expect(sampleRate).toBe(16000);

    // Check bits per sample at offset 34 (little-endian uint16)
    const bitsPerSample = buf[34] | (buf[35] << 8);
    expect(bitsPerSample).toBe(16);

    // Check channels at offset 22 (little-endian uint16)
    const channels = buf[22] | (buf[23] << 8);
    expect(channels).toBe(1);
  });
});

describe('checkQuality', () => {
  it('returns "too-short" for recordings under 8 seconds', () => {
    // 5 seconds at 16kHz
    const pcm = new Float32Array(16000 * 5);
    pcm.fill(0.3);
    const result = checkQuality(pcm, 16000);
    expect(result).toEqual({ type: 'too-short', blocking: true, message: expect.stringContaining('too short') });
  });

  it('returns null for a good recording', () => {
    // 10 seconds with moderate level
    const pcm = new Float32Array(16000 * 10);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin(i * 0.1);
    const result = checkQuality(pcm, 16000);
    expect(result).toBeNull();
  });

  it('returns "too-quiet" warning for very low RMS', () => {
    // 10 seconds of near-silence
    const pcm = new Float32Array(16000 * 10);
    pcm.fill(0.001);
    const result = checkQuality(pcm, 16000);
    expect(result).toEqual({ type: 'too-quiet', blocking: false, message: expect.stringContaining('quiet') });
  });

  it('returns "clipping" warning when >5% samples near max', () => {
    // 10 seconds, 10% of samples at ±0.99+
    const pcm = new Float32Array(16000 * 10);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = i < pcm.length * 0.1 ? 0.995 : 0.3 * Math.sin(i * 0.1);
    }
    const result = checkQuality(pcm, 16000);
    expect(result).toEqual({ type: 'clipping', blocking: false, message: expect.stringContaining('distorted') });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && pnpm test -- --run src/__tests__/wavEncoder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WAV encoder and quality check**

```typescript
// packages/core/src/hooks/wavEncoder.ts

export interface QualityWarning {
  type: 'too-short' | 'too-quiet' | 'clipping';
  blocking: boolean;
  message: string;
}

/**
 * Encode Float32 PCM samples into a WAV Blob (16-bit, mono).
 */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const numSamples = pcm.length;
  const bytesPerSample = 2; // Int16
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);            // subchunk size
  view.setUint16(20, 1, true);             // PCM format
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, sampleRate, true);     // sample rate
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true);            // bits per sample

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert Float32 [-1,1] to Int16
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Check recording quality. Returns the most severe warning, or null if OK.
 * Checks are ordered by severity: too-short (blocking) > clipping > too-quiet.
 */
export function checkQuality(pcm: Float32Array, sampleRate: number): QualityWarning | null {
  const durationSec = pcm.length / sampleRate;

  if (durationSec < 8) {
    return { type: 'too-short', blocking: true, message: 'Recording too short for good voice cloning. Try again.' };
  }

  // Clipping: >5% of samples at ±0.99
  let clipped = 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const abs = Math.abs(pcm[i]);
    if (abs >= 0.99) clipped++;
    sumSq += pcm[i] * pcm[i];
  }
  if (clipped / pcm.length > 0.05) {
    return { type: 'clipping', blocking: false, message: 'Audio may be distorted. Try speaking a bit softer.' };
  }

  // Too quiet: average RMS < 0.01
  const rms = Math.sqrt(sumSq / pcm.length);
  if (rms < 0.01) {
    return { type: 'too-quiet', blocking: false, message: 'Recording is very quiet. Try moving closer to your mic.' };
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && pnpm test -- --run src/__tests__/wavEncoder.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hooks/wavEncoder.ts packages/core/src/__tests__/wavEncoder.test.ts
git commit -m "feat(core): add WAV encoder and quality check utilities"
```

---

## Task 2: useVoiceRecorder Hook

State machine wrapping useTenVAD. Depends on Task 1 (wavEncoder).

**Files:**
- Create: `packages/core/src/hooks/useVoiceRecorder.ts`
- Create: `packages/core/src/__tests__/useVoiceRecorder.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for useVoiceRecorder**

The hook wraps `useTenVAD` which requires WASM + browser APIs. Tests mock `useTenVAD` at the module level. The existing `packages/test-setup.ts` provides `MockAudioContext` and `MockWebSocket` — reference it via the vitest config.

```typescript
// packages/core/src/__tests__/useVoiceRecorder.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock useTenVAD to avoid WASM loading
const mockStart = vi.fn();
const mockPause = vi.fn();
vi.mock('../hooks/useTenVAD', () => ({
  useTenVAD: vi.fn((opts: any) => {
    // Store callbacks so tests can simulate audio
    (globalThis as any).__tenVadOpts = opts;
    return { loading: false, errored: false, start: mockStart, pause: mockPause };
  }),
}));

import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import type { RecorderState } from '../hooks/useVoiceRecorder';

describe('useVoiceRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__tenVadOpts = null;
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.state).toBe('idle');
    expect(result.current.wavBlob).toBeNull();
    expect(result.current.qualityWarning).toBeNull();
  });

  it('transitions to ready state and calls useTenVAD.start()', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => { result.current.prepare(); });
    expect(result.current.state).toBe('ready');
    expect(mockStart).toHaveBeenCalled();
  });

  it('transitions from ready to recording', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => { result.current.prepare(); });
    act(() => { result.current.startRecording(); });
    expect(result.current.state).toBe('recording');
  });

  it('accumulates PCM from onRawAudio and produces WAV on stop', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => { result.current.prepare(); });
    act(() => { result.current.startRecording(); });

    // Simulate 10 seconds of audio chunks (16000 samples/sec, 256 per chunk)
    const chunksNeeded = Math.ceil((16000 * 10) / 256);
    const opts = (globalThis as any).__tenVadOpts;
    for (let i = 0; i < chunksNeeded; i++) {
      const chunk = new Float32Array(256);
      chunk.fill(0.3 * Math.sin(i * 0.1));
      act(() => { opts.onRawAudio(chunk); });
    }

    act(() => { result.current.stop(); });
    expect(result.current.state).toBe('review');
    expect(result.current.wavBlob).toBeInstanceOf(Blob);
    expect(result.current.qualityWarning).toBeNull();
    expect(mockPause).toHaveBeenCalled();
  });

  it('detects too-short recording', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => { result.current.prepare(); });
    act(() => { result.current.startRecording(); });

    // Simulate 3 seconds (too short)
    const opts = (globalThis as any).__tenVadOpts;
    const chunksNeeded = Math.ceil((16000 * 3) / 256);
    for (let i = 0; i < chunksNeeded; i++) {
      act(() => { opts.onRawAudio(new Float32Array(256).fill(0.3)); });
    }

    act(() => { result.current.stop(); });
    expect(result.current.state).toBe('review');
    expect(result.current.qualityWarning?.type).toBe('too-short');
    expect(result.current.qualityWarning?.blocking).toBe(true);
  });

  it('reset returns to ready state', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => { result.current.prepare(); });
    act(() => { result.current.startRecording(); });
    act(() => { result.current.stop(); });
    act(() => { result.current.reset(); });
    expect(result.current.state).toBe('ready');
    expect(result.current.wavBlob).toBeNull();
    expect(result.current.qualityWarning).toBeNull();
  });

  it('cancel returns to idle and calls pause', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    act(() => { result.current.prepare(); });
    act(() => { result.current.cancel(); });
    expect(result.current.state).toBe('idle');
    expect(mockPause).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Install test dependencies and configure jsdom environment**

The hook test uses `renderHook` from `@testing-library/react` which requires a DOM environment. The current vitest config (`packages/core/vitest.config.ts`) uses Node environment by default.

Run: `cd packages/core && pnpm add -D @testing-library/react jsdom`

Then add a vitest environment directive at the top of the test file (first line, before imports):

```typescript
// @vitest-environment jsdom
```

This is a per-file override — it does NOT change the vitest config, so existing pure-Node tests are unaffected.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/core && pnpm test -- --run src/__tests__/useVoiceRecorder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement useVoiceRecorder hook**

```typescript
// packages/core/src/hooks/useVoiceRecorder.ts
import { useCallback, useRef, useState } from 'react';
import { useTenVAD } from './useTenVAD';
import { encodeWav, checkQuality } from './wavEncoder';
import type { QualityWarning } from './wavEncoder';

export type RecorderState = 'idle' | 'ready' | 'recording' | 'review';

const MAX_DURATION_SEC = 45;
const SAMPLE_RATE = 16000;

export interface UseVoiceRecorderReturn {
  state: RecorderState;
  loading: boolean;
  error: false | object;
  elapsed: number;
  rmsLevel: number;
  wavBlob: Blob | null;
  qualityWarning: QualityWarning | null;
  prepare: () => void;
  startRecording: () => void;
  stop: () => void;
  reset: () => void;
  cancel: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [rmsLevel, setRmsLevel] = useState(0);
  const [wavBlob, setWavBlob] = useState<Blob | null>(null);
  const [qualityWarning, setQualityWarning] = useState<QualityWarning | null>(null);

  const chunksRef = useRef<Float32Array[]>([]);
  const isRecordingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const { loading, errored, start: vadStart, pause: vadPause } = useTenVAD({
    onRawAudio: useCallback((pcm: Float32Array) => {
      if (isRecordingRef.current) {
        chunksRef.current.push(pcm.slice());
      }
    }, []),
    onFrameProcessed: useCallback(({ rms }: { isSpeech: number; rms: number }) => {
      setRmsLevel(rms);
    }, []),
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const prepare = useCallback(() => {
    setState('ready');
    setElapsed(0);
    setWavBlob(null);
    setQualityWarning(null);
    chunksRef.current = [];
    vadStart();
  }, [vadStart]);

  const startRecording = useCallback(() => {
    isRecordingRef.current = true;
    chunksRef.current = [];
    startTimeRef.current = Date.now();
    setState('recording');
    setElapsed(0);

    timerRef.current = setInterval(() => {
      const sec = (Date.now() - startTimeRef.current) / 1000;
      setElapsed(sec);
      if (sec >= MAX_DURATION_SEC) {
        // Auto-stop — will be handled by the stop() call below
        isRecordingRef.current = false;
        clearTimer();
        finalize();
      }
    }, 200);
  }, [clearTimer]);

  const finalize = useCallback(() => {
    isRecordingRef.current = false;
    clearTimer();
    vadPause();

    // Merge chunks
    const totalLen = chunksRef.current.reduce((s, c) => s + c.length, 0);
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of chunksRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const warning = checkQuality(merged, SAMPLE_RATE);
    const blob = encodeWav(merged, SAMPLE_RATE);

    setWavBlob(blob);
    setQualityWarning(warning);
    setElapsed(totalLen / SAMPLE_RATE);
    setState('review');
  }, [clearTimer, vadPause]);

  const stop = useCallback(() => {
    finalize();
  }, [finalize]);

  const reset = useCallback(() => {
    setWavBlob(null);
    setQualityWarning(null);
    setElapsed(0);
    chunksRef.current = [];
    setState('ready');
    vadStart();
  }, [vadStart]);

  const cancel = useCallback(() => {
    isRecordingRef.current = false;
    clearTimer();
    vadPause();
    chunksRef.current = [];
    setWavBlob(null);
    setQualityWarning(null);
    setElapsed(0);
    setState('idle');
  }, [clearTimer, vadPause]);

  return {
    state, loading, error: errored, elapsed, rmsLevel,
    wavBlob, qualityWarning,
    prepare, startRecording, stop, reset, cancel,
  };
}
```

**Important: stale closure fix.** The `finalize` function is called from `startRecording`'s `setInterval` callback, but `startRecording` captures `finalize` in its closure when created. Since `finalize` depends on `vadPause` and `clearTimer`, it can go stale. Fix this with a ref (same pattern as `processFrameRef` in `useTenVAD`):

```typescript
const finalizeRef = useRef(finalize);
useEffect(() => { finalizeRef.current = finalize; });
```

Then in `startRecording`'s interval callback, call `finalizeRef.current()` instead of `finalize()`. This ensures the auto-stop at 45s always uses the latest closure.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && pnpm test -- --run src/__tests__/useVoiceRecorder.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Export from package index**

Add to `packages/core/src/index.ts`:

```typescript
export { useVoiceRecorder } from './hooks/useVoiceRecorder';
export type { UseVoiceRecorderReturn, RecorderState } from './hooks/useVoiceRecorder';
export type { QualityWarning } from './hooks/wavEncoder';
```

- [ ] **Step 7: Verify typecheck passes**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/hooks/useVoiceRecorder.ts packages/core/src/__tests__/useVoiceRecorder.test.ts packages/core/src/index.ts
git commit -m "feat(core): add useVoiceRecorder hook wrapping useTenVAD"
```

---

## Task 3: Server Duration Limit

One-line change, independent of other tasks.

**Files:**
- Modify: `packages/server/src/createPersonaRoutes.ts:182-183`

- [ ] **Step 1: Change duration limit from 30 to 45**

In `packages/server/src/createPersonaRoutes.ts`, change line 182:

```typescript
// Before:
          if (durationSec > 30) {
            res.status(400).json({ error: `Voice sample too long (${Math.round(durationSec)}s). Maximum is 30 seconds.` });

// After:
          if (durationSec > 45) {
            res.status(400).json({ error: `Voice sample too long (${Math.round(durationSec)}s). Maximum is 45 seconds.` });
```

- [ ] **Step 2: Verify build passes**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/createPersonaRoutes.ts
git commit -m "feat(server): bump voice sample duration limit to 45s"
```

---

## Task 4: Recording UI in PersonaSettings

Depends on Task 2 (useVoiceRecorder hook must exist and be exported).

**Files:**
- Modify: `packages/ui/src/components/PersonaSettings.tsx`

- [ ] **Step 1: Add prompt sentences constant**

At the top of `PersonaSettings.tsx`, after the `LANGUAGE_OPTIONS` constant:

```typescript
const RECORDING_PROMPTS = [
  'Good morning. I am here to help you with your registration process today.',
  'Could you please provide your business name and the type of license you need?',
  'Thank you for your patience. Your application has been submitted successfully.',
];
```

- [ ] **Step 2: Replace UploadButton with two side-by-side buttons**

In the `VoiceSection` component, replace the single `UploadButton` usage (around line 459-475) with two buttons. The section that currently reads:

```tsx
{!disabled && (
  showUpload ? (
    <UploadForm ... />
  ) : (
    <UploadButton ... />
  )
)}
```

Becomes:

```tsx
{!disabled && (
  showUpload ? (
    <UploadForm ... />
  ) : showRecording ? (
    <RecordingFlow
      onComplete={async (blob, name) => {
        const file = new File([blob], `${name}.wav`, { type: 'audio/wav' });
        await onUpload(file, name);
        setShowRecording(false);
      }}
      onCancel={() => setShowRecording(false)}
      primaryColor={primaryColor}
    />
  ) : (
    <div style={{ display: 'flex', gap: 8 }}>
      <RecordButton
        disabled={voices.length >= 10}
        onClick={() => setShowRecording(true)}
      />
      <UploadFileButton
        disabled={voices.length >= 10}
        onClick={() => inputRef.current?.click()}
      />
    </div>
  )
)}
```

Add `const [showRecording, setShowRecording] = useState(false);` to VoiceSection state.

- [ ] **Step 3: Implement RecordButton and UploadFileButton**

Two small components replacing the old `UploadButton`:

```tsx
function RecordButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        fontSize: 11,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px dashed #d1d5db',
        backgroundColor: hovered && !disabled ? '#f9fafb' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.15s',
        fontFamily: 'inherit',
      }}
    >
      Record voice sample
    </button>
  );
}

function UploadFileButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        fontSize: 11,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px dashed #d1d5db',
        backgroundColor: hovered && !disabled ? '#f9fafb' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.15s',
        fontFamily: 'inherit',
      }}
    >
      Upload WAV (max 45s)
    </button>
  );
}
```

- [ ] **Step 4: Implement RecordingFlow component**

The main component with 4 visual states (loading/error, ready, recording, review):

```tsx
function RecordingFlow({ onComplete, onCancel, primaryColor }: {
  onComplete: (blob: Blob, name: string) => Promise<void>;
  onCancel: () => void;
  primaryColor: string;
}) {
  const recorder = useVoiceRecorder();
  const [name, setName] = useState('Recording');
  const [uploading, setUploading] = useState(false);

  // Auto-prepare on mount
  useEffect(() => { recorder.prepare(); }, []);

  const handleUpload = async () => {
    if (!recorder.wavBlob) return;
    setUploading(true);
    try {
      await onComplete(recorder.wavBlob, name);
    } catch (err) {
      console.error('Voice upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  // Loading state
  if (recorder.loading) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
        Preparing microphone...
      </div>
    );
  }

  // Error state (WASM failed or mic denied)
  if (recorder.error) {
    return (
      <div style={{
        padding: 12, borderRadius: 8, border: '1px solid #fca5a5',
        backgroundColor: '#fef2f2', fontSize: 12,
      }}>
        <div style={{ color: '#dc2626', marginBottom: 8 }}>
          Could not access microphone. Please check your browser permissions.
        </div>
        <button onClick={onCancel} style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 6,
          border: '1px solid #e5e7eb', backgroundColor: '#fff',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Cancel</button>
      </div>
    );
  }

  // Ready state
  if (recorder.state === 'ready') {
    return (
      <div style={{
        padding: 12, borderRadius: 10, border: '1px solid #e5e7eb',
        backgroundColor: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          Use a quiet room and speak naturally.
        </div>
        <PromptSentences />
        <LevelMeter rms={recorder.rmsLevel} active={false} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={recorder.startRecording} style={{
            flex: 1, padding: 8, borderRadius: 8, border: 'none',
            backgroundColor: '#dc2626', color: '#fff', fontSize: 12,
            fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#fff', display: 'inline-block',
            }} />
            Start recording
          </button>
          <button onClick={onCancel} style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
            backgroundColor: '#fff', fontSize: 12, color: '#6b7280',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
        </div>
      </div>
    );
  }

  // Recording state
  if (recorder.state === 'recording') {
    return (
      <div style={{
        padding: 12, borderRadius: 10, border: '1px solid #fca5a5',
        backgroundColor: '#fef2f2', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <PromptSentences />
        <LevelMeter rms={recorder.rmsLevel} active elapsed={recorder.elapsed} maxDuration={45} />
        <button onClick={recorder.stop} style={{
          width: '100%', padding: 8, borderRadius: 8, border: 'none',
          backgroundColor: '#1f2937', color: '#fff', fontSize: 12,
          fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: 2,
            background: '#fff', display: 'inline-block',
          }} />
          Stop recording
        </button>
      </div>
    );
  }

  // Review state
  return (
    <div style={{
      padding: 12, borderRadius: 10, border: '1px solid #e5e7eb',
      backgroundColor: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <WaveformPreview blob={recorder.wavBlob} duration={recorder.elapsed} />
      <QualityBadge warning={recorder.qualityWarning} />
      <input
        type="text" value={name} onChange={e => setName(e.target.value)}
        placeholder="Voice name"
        style={{
          width: '100%', fontSize: 13, padding: '6px 10px', borderRadius: 8,
          border: '1px solid #e5e7eb', outline: 'none', fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        {(!recorder.qualityWarning?.blocking) && (
          <button onClick={handleUpload} disabled={uploading || !name} style={{
            flex: 1, padding: 8, borderRadius: 8, border: 'none',
            backgroundColor: '#1f2937', color: '#fff', fontSize: 12,
            fontWeight: 500, cursor: uploading || !name ? 'default' : 'pointer',
            opacity: uploading || !name ? 0.5 : 1, fontFamily: 'inherit',
          }}>
            {uploading ? 'Processing (~8s)...' : 'Use this recording'}
          </button>
        )}
        <button onClick={recorder.reset} style={{
          padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
          backgroundColor: '#fff', fontSize: 12, color: '#6b7280',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Re-record</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement sub-components (PromptSentences, LevelMeter, WaveformPreview, QualityBadge)**

```tsx
function PromptSentences() {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12,
    }}>
      <div style={{
        fontSize: 10, color: '#9ca3af', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 8,
      }}>Read aloud</div>
      {RECORDING_PROMPTS.map((sentence, i) => (
        <div key={i} style={{
          fontSize: 13, color: '#374151', lineHeight: 1.6,
          marginBottom: i < RECORDING_PROMPTS.length - 1 ? 6 : 0,
        }}>
          {i + 1}. "{sentence}"
        </div>
      ))}
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, fontStyle: 'italic' }}>
        Pause briefly between each sentence.
      </div>
    </div>
  );
}

function LevelMeter({ rms, active, elapsed, maxDuration }: {
  rms: number; active?: boolean; elapsed?: number; maxDuration?: number;
}) {
  // Render 8 bars driven by RMS value
  const color = active ? '#dc2626' : '#d1d5db';
  const barCount = 8;
  const heights = Array.from({ length: barCount }, (_, i) => {
    // Scale RMS (0-0.5 typical) to bar heights (4-20px) with some variation
    const base = Math.min(1, rms * 5);
    const variation = Math.sin(i * 1.7 + (elapsed ?? 0) * 3) * 0.3 + 0.7;
    return 4 + base * variation * 16;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 2, alignItems: 'end', height: 20 }}>
        {heights.map((h, i) => (
          <div key={i} style={{
            width: 3, height: h, backgroundColor: color, borderRadius: 1,
            transition: 'height 0.1s',
          }} />
        ))}
      </div>
      {active && elapsed != null && maxDuration != null ? (
        <>
          <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>
            {formatTime(elapsed)} / {formatTime(maxDuration)}
          </span>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', backgroundColor: '#dc2626',
            display: 'inline-block',
          }} />
        </>
      ) : (
        <span style={{ fontSize: 11, color: '#9ca3af' }}>Mic ready</span>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function WaveformPreview({ blob, duration }: { blob: Blob | null; duration: number }) {
  const [playing, setPlaying] = useState(false);
  const [bars, setBars] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Downsample WAV blob to ~60 bars on mount
  const barCount = 60;
  useEffect(() => {
    if (!blob) return;
    blob.arrayBuffer().then(buf => {
      // Skip 44-byte WAV header, read Int16 samples
      const samples = new Int16Array(buf, 44);
      const chunkSize = Math.max(1, Math.floor(samples.length / barCount));
      const result: number[] = [];
      for (let i = 0; i < barCount; i++) {
        let maxAbs = 0;
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, samples.length);
        for (let j = start; j < end; j++) {
          const abs = Math.abs(samples[j]) / 32768;
          if (abs > maxAbs) maxAbs = abs;
        }
        result.push(maxAbs);
      }
      setBars(result);
    });
  }, [blob]);

  const handlePlay = () => {
    if (!blob) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); setPlaying(false); audioRef.current = null; };
    audioRef.current = audio;
    setPlaying(true);
    audio.play();
  };

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      padding: 12, display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <button onClick={handlePlay} style={{
        width: 28, height: 28, borderRadius: '50%', border: 'none',
        backgroundColor: '#1f2937', color: '#fff', fontSize: 10,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{playing ? '⏸' : '▶'}</button>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 1, alignItems: 'center', height: 24 }}>
          {bars.map((level, i) => (
            <div key={i} style={{
              width: 2, height: Math.max(2, level * 22),
              backgroundColor: '#6b7280', borderRadius: 1,
            }} />
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
          {formatTime(duration)}
        </div>
      </div>
    </div>
  );
}

function QualityBadge({ warning }: { warning: QualityWarning | null }) {
  if (!warning) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6,
      }}>
        <span style={{ color: '#16a34a', fontSize: 12 }}>✓</span>
        <span style={{ fontSize: 11, color: '#166534' }}>Good quality — clear audio, low noise</span>
      </div>
    );
  }

  const isBlocking = warning.blocking;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
      background: isBlocking ? '#fef2f2' : '#fffbeb',
      border: `1px solid ${isBlocking ? '#fca5a5' : '#fde68a'}`,
      borderRadius: 6,
    }}>
      <span style={{ color: isBlocking ? '#dc2626' : '#d97706', fontSize: 12 }}>
        {isBlocking ? '✗' : '⚠'}
      </span>
      <span style={{ fontSize: 11, color: isBlocking ? '#991b1b' : '#92400e' }}>
        {warning.message}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Add import for useVoiceRecorder and QualityWarning at top of PersonaSettings.tsx**

```typescript
import { usePersonaContext, useSiteConfig } from '@unctad-ai/voice-agent-core';
// Add:
import { useVoiceRecorder } from '@unctad-ai/voice-agent-core';
import type { QualityWarning } from '@unctad-ai/voice-agent-core';
```

- [ ] **Step 7: Build all packages and verify no errors**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build && pnpm typecheck`
Expected: Both succeed

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/PersonaSettings.tsx
git commit -m "feat(ui): add voice recording flow to persona settings"
```

---

## Task 5: Integration Smoke Test

Manual verification with a running Swkenya instance.

- [ ] **Step 1: Build kit and start Docker**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build && pnpm docker:kenya`

- [ ] **Step 2: Open persona settings and verify two buttons**

Open http://localhost:3000, go to settings → persona. Verify "Record voice sample" and "Upload WAV (max 45s)" buttons appear side by side.

- [ ] **Step 3: Test recording flow**

1. Click "Record voice sample" — verify mic permission prompt, then Ready state with live level meter
2. Click "Start recording" — verify timer counts up, level meter turns red
3. Read the 3 sentences — verify the level meter responds to voice
4. Click "Stop recording" — verify Review state with playback, quality badge, name field
5. Click play — verify the recording plays back
6. Click "Use this recording" — verify it uploads and appears in the voice list
7. Verify the new voice can be previewed with the existing Preview button

- [ ] **Step 4: Test edge cases**

1. Record < 8 seconds → stop → verify "too short" blocking warning, no "Use this recording" button
2. Click "Re-record" → verify returns to Ready state
3. Click "Cancel" from Ready state → verify returns to two buttons
4. Let recording run to 45s → verify auto-stop
5. Upload a WAV via the upload button → verify it still works at max 45s

- [ ] **Step 5: Commit any fixes from smoke testing**

```bash
git add -u
git commit -m "fix: address issues from recording flow smoke test"
```
(Only if fixes are needed)
