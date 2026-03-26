/**
 * useTenVAD — React hook wrapping TEN VAD (WebAssembly) for browser voice
 * activity detection.  Drop-in replacement for `useMicVAD` from
 * `@ricky0123/vad-react` with the same callback/state contract.
 *
 * Architecture:
 *   AudioContext (native rate) → AudioWorkletNode (ten-vad-processor.js)
 *     → resample to 16 kHz → postMessage Float32 chunks
 *     → main-thread WASM inference → speech segmentation → callbacks
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of the Emscripten TEN VAD module interface we actually use */
interface TenVADModule {
  _ten_vad_create(handlePtr: number, hopSize: number, threshold: number): number;
  _ten_vad_process(
    handle: number,
    audioDataPtr: number,
    audioDataLength: number,
    outProbabilityPtr: number,
    outFlagPtr: number
  ): number;
  _ten_vad_destroy(handlePtr: number): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAP16: Int16Array;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
}

export interface UseTenVADOptions {
  /** Start capturing immediately on mount (default false) */
  startOnLoad?: boolean;
  /** Hop size in samples for each VAD frame at 16 kHz (default 256 = 16 ms) */
  hopSize?: number;
  /** VAD probability threshold [0-1] (default 0.5) */
  threshold?: number;
  /** Probability above which speech is considered to have started */
  positiveSpeechThreshold?: number;
  /** Probability below which speech is considered to have ended */
  negativeSpeechThreshold?: number;
  /** How long (ms) speech must stay below negative threshold before segment ends */
  redemptionMs?: number;
  /** Minimum speech duration (ms) to fire onSpeechEnd; shorter = onVADMisfire */
  minSpeechMs?: number;
  /** Audio to keep before speech onset (ms) */
  preSpeechPadMs?: number;

  // Callbacks
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onVADMisfire?: () => void;
  onFrameProcessed?: (probabilities: { isSpeech: number; rms: number }) => void;
  /** Called with each raw 256-sample PCM chunk from the AudioWorklet (16 kHz mono Float32). */
  onRawAudio?: (pcm: Float32Array) => void;
}

type SegmentState = 'idle' | 'speaking' | 'redemption';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Float32 [-1,1] to Int16 for TEN VAD */
function float32ToInt16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return i16;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTenVAD(options: UseTenVADOptions = {}) {
  const {
    startOnLoad = false,
    hopSize = 256,
    threshold = 0.5,
    positiveSpeechThreshold = 0.6,
    negativeSpeechThreshold = 0.35,
    redemptionMs = 600,
    minSpeechMs = 500,
    preSpeechPadMs = 400,
    onSpeechStart,
    onSpeechEnd,
    onVADMisfire,
    onFrameProcessed,
    onRawAudio,
  } = options;

  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState<false | object>(false);

  // Stable refs for callbacks so we never re-create the worklet listener
  const cbRef = useRef({ onSpeechStart, onSpeechEnd, onVADMisfire, onFrameProcessed, onRawAudio });
  useEffect(() => {
    cbRef.current = { onSpeechStart, onSpeechEnd, onVADMisfire, onFrameProcessed, onRawAudio };
  });

  // WASM module + handle
  const moduleRef = useRef<TenVADModule | null>(null);
  const vadHandleRef = useRef<number>(0);

  // Audio graph
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Speech segmentation state
  const segStateRef = useRef<SegmentState>('idle');
  const speechFramesRef = useRef(0);
  const redemptionFramesRef = useRef(0);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const preSpeechBufferRef = useRef<Float32Array[]>([]);

  // Compute frame counts from ms
  const frameDurationMs = (hopSize / 16000) * 1000; // e.g. 256/16000*1000 = 16 ms
  const redemptionFrames = Math.ceil(redemptionMs / frameDurationMs);
  const minSpeechFrames = Math.ceil(minSpeechMs / frameDurationMs);
  const preSpeechFrames = Math.ceil(preSpeechPadMs / frameDurationMs);

  // Active flag to prevent work after unmount
  const activeRef = useRef(false);

  // -----------------------------------------------------------------------
  // WASM memory helpers (allocated once per module lifetime)
  // -----------------------------------------------------------------------
  const ptrsRef = useRef<{
    audioPtr: number;
    probPtr: number;
    flagPtr: number;
  } | null>(null);

  const allocPtrs = useCallback(
    (mod: TenVADModule) => {
      if (ptrsRef.current) return ptrsRef.current;
      const audioPtr = mod._malloc(hopSize * 2); // Int16 = 2 bytes/sample
      const probPtr = mod._malloc(4); // float
      const flagPtr = mod._malloc(4); // int32
      ptrsRef.current = { audioPtr, probPtr, flagPtr };
      return ptrsRef.current;
    },
    [hopSize]
  );

  const freePtrs = useCallback((mod: TenVADModule) => {
    if (!ptrsRef.current) return;
    mod._free(ptrsRef.current.audioPtr);
    mod._free(ptrsRef.current.probPtr);
    mod._free(ptrsRef.current.flagPtr);
    ptrsRef.current = null;
  }, []);

  // -----------------------------------------------------------------------
  // Process a single frame from the AudioWorklet
  // -----------------------------------------------------------------------
  const processFrame = useCallback(
    (samples: Float32Array) => {
      const mod = moduleRef.current;
      if (!mod || !vadHandleRef.current) return;

      const ptrs = allocPtrs(mod);
      const i16 = float32ToInt16(samples);

      // Copy Int16 samples into WASM heap
      mod.HEAP16.set(i16, ptrs.audioPtr >> 1);

      const ret = mod._ten_vad_process(
        vadHandleRef.current,
        ptrs.audioPtr,
        hopSize,
        ptrs.probPtr,
        ptrs.flagPtr
      );

      if (ret !== 0) return;

      const probability = mod.HEAPF32[ptrs.probPtr >> 2];
      // Compute frame RMS for barge-in energy gating
      let sumSq = 0;
      for (let j = 0; j < samples.length; j++) sumSq += samples[j] * samples[j];
      const rms = Math.sqrt(sumSq / samples.length);
      cbRef.current.onFrameProcessed?.({ isSpeech: probability, rms });

      // ---- Speech segmentation state machine ----
      const seg = segStateRef.current;

      if (seg === 'idle') {
        // Maintain rolling pre-speech buffer
        preSpeechBufferRef.current.push(samples);
        if (preSpeechBufferRef.current.length > preSpeechFrames) {
          preSpeechBufferRef.current.shift();
        }

        if (probability >= positiveSpeechThreshold) {
          segStateRef.current = 'speaking';
          speechFramesRef.current = 1;
          redemptionFramesRef.current = 0;

          // Start audio accumulation with pre-speech pad
          audioChunksRef.current = [...preSpeechBufferRef.current, samples];
          preSpeechBufferRef.current = [];

          cbRef.current.onSpeechStart?.();
        }
      } else if (seg === 'speaking') {
        speechFramesRef.current++;
        audioChunksRef.current.push(samples);

        if (probability < negativeSpeechThreshold) {
          segStateRef.current = 'redemption';
          redemptionFramesRef.current = 1;
        }
      } else if (seg === 'redemption') {
        speechFramesRef.current++;
        redemptionFramesRef.current++;
        audioChunksRef.current.push(samples);

        if (probability >= positiveSpeechThreshold) {
          // Speech resumed — go back
          segStateRef.current = 'speaking';
          redemptionFramesRef.current = 0;
        } else if (redemptionFramesRef.current >= redemptionFrames) {
          // Speech truly ended
          segStateRef.current = 'idle';

          if (speechFramesRef.current >= minSpeechFrames) {
            // Concatenate all chunks into one Float32Array
            const totalLen = audioChunksRef.current.reduce((s, c) => s + c.length, 0);
            const merged = new Float32Array(totalLen);
            let offset = 0;
            for (const chunk of audioChunksRef.current) {
              merged.set(chunk, offset);
              offset += chunk.length;
            }
            cbRef.current.onSpeechEnd?.(merged);
          } else {
            cbRef.current.onVADMisfire?.();
          }

          audioChunksRef.current = [];
          speechFramesRef.current = 0;
          redemptionFramesRef.current = 0;
        }
      }
    },
    [
      hopSize,
      allocPtrs,
      positiveSpeechThreshold,
      negativeSpeechThreshold,
      redemptionFrames,
      minSpeechFrames,
      preSpeechFrames,
    ]
  );

  // -----------------------------------------------------------------------
  // Stable ref for processFrame so worklet listener never goes stale
  // -----------------------------------------------------------------------
  const processFrameRef = useRef(processFrame);
  useEffect(() => {
    processFrameRef.current = processFrame;
  });

  // -----------------------------------------------------------------------
  // Load WASM module once
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Vendored Emscripten glue for TEN-VAD (MIT licensed).
        // Bundled directly to avoid fragile npm alias / exports issues.
        const { default: createVADModule } = await import('../vad/ten_vad.js');

        const mod: TenVADModule = await createVADModule({
          locateFile: (filename: string) => {
            if (filename.endsWith('.wasm')) return '/ten_vad.wasm';
            return filename;
          },
        });

        if (cancelled) return;

        // Create VAD handle
        const handlePtr = mod._malloc(4);
        const ret = mod._ten_vad_create(handlePtr, hopSize, threshold);
        if (ret !== 0) {
          mod._free(handlePtr);
          throw new Error('ten_vad_create failed');
        }

        const handle = mod.HEAP32[handlePtr >> 2];
        mod._free(handlePtr);

        moduleRef.current = mod;
        vadHandleRef.current = handle;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[useTenVAD] Failed to load WASM module:', err);
          setErrored(err instanceof Error ? err : { message: String(err) });
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hopSize, threshold]);

  // -----------------------------------------------------------------------
  // start / pause
  // -----------------------------------------------------------------------
  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      // Create AudioContext at native device rate — Chrome throws if it
      // doesn't match the MediaStream sample rate (Firefox resamples silently).
      // The AudioWorklet resamples to 16 kHz internally.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      // Inline AudioWorklet processor with built-in resampling to 16 kHz
      const workletSource = `
class TenVADProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.hopSize = options?.processorOptions?.hopSize ?? 256;
    this.targetRate = 16000;
    this.nativeRate = sampleRate; // AudioWorklet global
    this.ratio = this.nativeRate / this.targetRate;
    this.buffer = new Float32Array(this.hopSize);
    this.offset = 0;
    this.resamplePos = 0; // fractional position in the native-rate input
    this.active = true;
    this.port.onmessage = (e) => { if (e.data?.type === 'stop') this.active = false; };
  }
  process(inputs) {
    if (!this.active) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;

    // If native rate matches target, skip resampling
    if (this.ratio <= 1.0001) {
      let srcOffset = 0;
      while (srcOffset < input.length) {
        const toCopy = Math.min(this.hopSize - this.offset, input.length - srcOffset);
        this.buffer.set(input.subarray(srcOffset, srcOffset + toCopy), this.offset);
        this.offset += toCopy;
        srcOffset += toCopy;
        if (this.offset >= this.hopSize) {
          this.port.postMessage({ type: 'audio', samples: this.buffer.slice() });
          this.offset = 0;
        }
      }
      return true;
    }

    // Resample: linear interpolation from nativeRate to 16 kHz
    while (this.resamplePos < input.length - 1) {
      const idx = Math.floor(this.resamplePos);
      const frac = this.resamplePos - idx;
      this.buffer[this.offset] = input[idx] * (1 - frac) + input[idx + 1] * frac;
      this.offset++;
      this.resamplePos += this.ratio;
      if (this.offset >= this.hopSize) {
        this.port.postMessage({ type: 'audio', samples: this.buffer.slice() });
        this.offset = 0;
      }
    }
    this.resamplePos -= input.length;
    return true;
  }
}
registerProcessor('ten-vad-processor', TenVADProcessor);`;
      const workletBlob = new Blob([workletSource], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(workletBlob);
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'ten-vad-processor', {
        processorOptions: { hopSize },
      });

      worklet.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'audio') {
          const samples = e.data.samples as Float32Array;
          cbRef.current.onRawAudio?.(samples);
          processFrameRef.current(samples);
        }
      };

      source.connect(worklet);
      // Don't connect to destination — we don't want to hear the mic
      workletNodeRef.current = worklet;
    } catch (err) {
      activeRef.current = false;
      console.error('[useTenVAD] start failed:', err);
      setErrored(err instanceof Error ? err : { message: String(err) });
    }
  }, [hopSize]);

  const pause = useCallback(() => {
    activeRef.current = false;

    // Tell worklet to stop
    workletNodeRef.current?.port.postMessage({ type: 'stop' });
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;

    // Stop mic
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    // Close audio context
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    // Reset segmentation state
    segStateRef.current = 'idle';
    speechFramesRef.current = 0;
    redemptionFramesRef.current = 0;
    audioChunksRef.current = [];
    preSpeechBufferRef.current = [];
  }, []);

  // -----------------------------------------------------------------------
  // Auto-start if requested
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (startOnLoad && !loading && !errored) {
      start();
    }
  }, [startOnLoad, loading, errored, start]);

  // -----------------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------------
  useEffect(() => {
    return () => {
      activeRef.current = false;

      workletNodeRef.current?.port.postMessage({ type: 'stop' });
      workletNodeRef.current?.disconnect();
      workletNodeRef.current = null;

      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      audioCtxRef.current?.close();
      audioCtxRef.current = null;

      // Destroy WASM handle
      const mod = moduleRef.current;
      if (mod && vadHandleRef.current) {
        const handlePtr = mod._malloc(4);
        mod.HEAP32[handlePtr >> 2] = vadHandleRef.current;
        mod._ten_vad_destroy(handlePtr);
        mod._free(handlePtr);
        vadHandleRef.current = 0;
      }

      if (mod) {
        freePtrs(mod);
      }
    };
  }, [freePtrs]);

  return { loading, errored, start, pause };
}
