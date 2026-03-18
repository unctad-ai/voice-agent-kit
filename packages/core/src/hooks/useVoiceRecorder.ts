import { useCallback, useEffect, useRef, useState } from 'react';
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

  // Ref-stable finalize for use in setInterval (avoids stale closure)
  const finalizeRef = useRef(finalize);
  useEffect(() => { finalizeRef.current = finalize; });

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
        finalizeRef.current();
      }
    }, 200);
  }, []);

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
