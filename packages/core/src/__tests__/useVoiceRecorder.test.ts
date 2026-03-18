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

  it('accumulates PCM from onRawAudio and produces WAV on stop', () => {
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

    const opts = (globalThis as any).__tenVadOpts;
    for (let i = 0; i < 10; i++) {
      act(() => { opts.onRawAudio(new Float32Array(256).fill(0.3)); });
    }

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
