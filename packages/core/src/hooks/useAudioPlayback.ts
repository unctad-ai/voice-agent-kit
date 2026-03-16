import { useCallback, useEffect, useRef, useState } from 'react';
import { parseWavHeader, pcmToFloat32 } from '../utils/wavParser';
import { WAV_HEADER_SIZE, TTS_STREAM_CHUNK_MS } from '../config/defaults';
import { PcmBufferQueue } from '../utils/pcmBufferQueue';

export interface UseAudioPlaybackOptions {
  onPlaybackEnd?: () => void;
  volumeRef?: React.RefObject<number>;
  speedRef?: React.RefObject<number>;
}

export function useAudioPlayback({
  onPlaybackEnd,
  volumeRef,
  speedRef,
}: UseAudioPlaybackOptions = {}) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const streamingSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
  }, [onPlaybackEnd]);
  const playPromiseResolveRef = useRef<(() => void) | null>(null);
  /** When true, suppress onPlaybackEnd in onended — explicit stop, not natural end */
  const stoppingRef = useRef(false);

  /** Next scheduled time for streaming chunk scheduling */
  const streamNextTimeRef = useRef(0);

  /** Sample-exact scheduling for playPcmChunk — tracks total samples queued */
  const pcmScheduleStartRef = useRef(0);
  const pcmTotalSamplesRef = useRef(0);
  const pcmNextTimeRef = useRef(0);
  const pcmFirstChunkRef = useRef(true);
  const pcmBufferQueueRef = useRef(new PcmBufferQueue());

  const getContext = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext();
        gainRef.current = audioCtxRef.current.createGain();
        gainRef.current.gain.value = volumeRef?.current ?? 1;
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        // Chain: source → gain → analyser → destination
        gainRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);
        setAnalyserNode(analyserRef.current);
      } catch (err) {
        console.error('[useAudioPlayback] Failed to create AudioContext:', err);
        return null;
      }
    }
    return audioCtxRef.current;
  }, []);

  /** Call on first user gesture (e.g. FAB click) to eagerly create AudioContext.
   *  Mobile Safari requires AudioContext creation inside a user-triggered event. */
  const initContext = useCallback(() => {
    const ctx = getContext();
    if (!ctx) console.warn('[useAudioPlayback] initContext: AudioContext unavailable');
  }, [getContext]);

  /** Smoothly ramp gain to new volume (15ms ramp, no clicks) */
  const applyVolume = useCallback((v: number) => {
    const ctx = audioCtxRef.current;
    const gain = gainRef.current;
    if (ctx && gain) {
      gain.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
    }
  }, []);

  const playAudio = useCallback(
    async (audioBuffer: ArrayBuffer): Promise<void> => {
      const ctx = getContext();
      if (!ctx) throw new Error('AudioContext unavailable — cannot play audio');
      if (ctx.state === 'suspended') await ctx.resume();

      // Stop any current playback and resolve pending promise
      try {
        sourceRef.current?.stop();
      } catch {
        // ignore
      }
      playPromiseResolveRef.current?.();
      playPromiseResolveRef.current = null;

      const buffer = await ctx.decodeAudioData(audioBuffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      if (speedRef) source.playbackRate.value = speedRef.current;
      source.connect(gainRef.current!);
      sourceRef.current = source;

      return new Promise<void>((resolve) => {
        playPromiseResolveRef.current = resolve;
        source.onended = () => {
          sourceRef.current = null;
          playPromiseResolveRef.current = null;
          if (!stoppingRef.current) {
            onPlaybackEndRef.current?.();
          }
          resolve();
        };
        source.start();
      });
    },
    [getContext, speedRef]
  );

  const stopAudio = useCallback(() => {
    // Suppress onPlaybackEnd during explicit stop — the caller manages state.
    stoppingRef.current = true;

    // Resume context if suspended — prevents stuck state after barge-in.
    // source.stop() works on a suspended context (it marks the source for
    // stopping; the audio thread processes it when resumed), but resuming
    // ensures onended fires promptly for cleanup.
    const ctx = audioCtxRef.current;
    if (ctx?.state === 'suspended') {
      ctx.resume(); // fire-and-forget
    }

    // Stop buffered playback source
    try {
      sourceRef.current?.stop();
    } catch {
      // If stop() throws, onended won't fire — resolve the hanging promise
    }
    sourceRef.current = null;

    // Stop all streaming playback sources
    for (const src of streamingSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore — may already have ended
      }
    }
    streamingSourcesRef.current = [];

    playPromiseResolveRef.current?.();
    playPromiseResolveRef.current = null;

    stoppingRef.current = false;
  }, []);

  /**
   * Suspend audio playback for two-phase barge-in.
   * Uses AudioContext.suspend() to freeze the entire audio graph in place —
   * all scheduled sources pause mid-playback. Works identically for streaming
   * (CosyVoice, Chatterbox, Resemble) and buffered (Pocket TTS) providers.
   * New chunks from the TTS stream continue to be scheduled on the frozen
   * context and will play seamlessly when resumePlayback() unfreezes it.
   */
  const suspendPlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'running') {
      ctx.suspend(); // fire-and-forget — resolves in ~microseconds on audio thread
    }
  }, []);

  /**
   * Resume audio playback after a false barge-in.
   * Unfreezes the AudioContext — all paused and newly scheduled sources
   * continue playing from exactly where they stopped. Zero content loss.
   */
  const resumePlayback = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume(); // fire-and-forget
    }
  }, []);

  /**
   * Stream audio chunks for gapless playback as they arrive.
   * Parses the WAV header from the first bytes, then converts PCM chunks
   * into AudioBuffers scheduled for back-to-back playback.
   *
   * During AudioContext.suspend() (barge-in), chunks continue to be parsed
   * and scheduled normally — they simply won't produce audio until the
   * context is resumed. This eliminates all buffering complexity.
   */
  const playStreamingAudio = useCallback(
    async (chunks: AsyncGenerator<Uint8Array>, signal?: AbortSignal): Promise<void> => {
      const ctx = getContext();
      if (!ctx) throw new Error('AudioContext unavailable — cannot play streaming audio');
      if (ctx.state === 'suspended') await ctx.resume();

      // Stop any current playback
      try {
        sourceRef.current?.stop();
      } catch {
        // ignore
      }
      for (const src of streamingSourcesRef.current) {
        try {
          src.stop();
        } catch {
          /* ignore */
        }
      }
      streamingSourcesRef.current = [];
      playPromiseResolveRef.current?.();
      playPromiseResolveRef.current = null;

      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      // Deferred resolve/reject — the promise settles when the last AudioBufferSourceNode ends
      let resolvePlayback!: () => void;
      let rejectPlayback!: (err: unknown) => void;
      const playbackPromise = new Promise<void>((resolve, reject) => {
        resolvePlayback = resolve;
        rejectPlayback = reject;
      });
      playPromiseResolveRef.current = resolvePlayback;

      const onAbort = () => {
        for (const src of streamingSourcesRef.current) {
          try {
            src.stop();
          } catch {
            /* ignore */
          }
        }
        streamingSourcesRef.current = [];
        playPromiseResolveRef.current = null;
        rejectPlayback(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        let headerBuf = new Uint8Array(0);
        let header: ReturnType<typeof parseWavHeader> | null = null;
        let pcmCarry = new Uint8Array(0); // leftover PCM bytes between chunks
        let firstChunk = true;

        let bytesPerChunk = 0; // set after header is parsed

        // Sample-exact scheduling: track total samples as integer to avoid
        // floating-point drift from repeated audioBuffer.duration additions.
        // 0.15s (150ms at 24kHz = 3600 samples) is NOT exactly representable
        // in float64; adding it ~47 times for a 7s clip accumulates error
        // that creates micro-gaps/overlaps → audible clicks.
        let scheduleStartTime = 0;
        let totalSamplesScheduled = 0;
        let sampleRate = 0;
        streamNextTimeRef.current = 0;

        for await (const chunk of chunks) {
          if (signal?.aborted) break;

          if (!header) {
            // Accumulate bytes until we have the full WAV header
            const merged = new Uint8Array(headerBuf.length + chunk.length);
            merged.set(headerBuf);
            merged.set(chunk, headerBuf.length);
            headerBuf = merged;

            if (headerBuf.length < WAV_HEADER_SIZE) continue;

            header = parseWavHeader(headerBuf.slice(0, WAV_HEADER_SIZE));
            sampleRate = header.sampleRate;
            // Compute chunk size from target duration — adapts to any sample rate
            const samplesPerChunk = Math.floor((sampleRate * TTS_STREAM_CHUNK_MS) / 1000);
            bytesPerChunk = samplesPerChunk * header.bytesPerSample;

            // Remaining bytes after header are PCM data
            const remaining = headerBuf.slice(WAV_HEADER_SIZE);
            if (remaining.length > 0) {
              pcmCarry = remaining;
            }
            headerBuf = new Uint8Array(0); // free
          } else {
            // Append chunk to PCM carry buffer
            const merged = new Uint8Array(pcmCarry.length + chunk.length);
            merged.set(pcmCarry);
            merged.set(chunk, pcmCarry.length);
            pcmCarry = merged;
          }

          // Schedule AudioBuffers from accumulated PCM.
          // During AudioContext.suspend(), these sources are created and
          // scheduled normally — they just won't produce audio until resumed.
          while (pcmCarry.length >= bytesPerChunk) {
            const pcmSlice = pcmCarry.slice(0, bytesPerChunk);
            pcmCarry = pcmCarry.slice(bytesPerChunk);

            const float32 = pcmToFloat32(pcmSlice, header) as Float32Array<ArrayBuffer>;

            const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
            audioBuffer.copyToChannel(float32, 0);

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            if (speedRef) source.playbackRate.value = speedRef.current;
            source.connect(gainRef.current!);
            streamingSourcesRef.current.push(source);

            // Clean up each source when it finishes — keeps the array bounded
            // to only currently-playing/scheduled sources during suspension.
            source.onended = () => {
              const idx = streamingSourcesRef.current.indexOf(source);
              if (idx !== -1) streamingSourcesRef.current.splice(idx, 1);
            };

            if (firstChunk) {
              // 25ms lookahead: by the time source.start() runs, ctx.currentTime
              // has advanced past the read value. Starting in the past causes the
              // buffer to play immediately, overlapping the next scheduled buffer → click.
              scheduleStartTime = ctx.currentTime + 0.025;
              streamNextTimeRef.current = scheduleStartTime;
              firstChunk = false;
            }

            source.start(streamNextTimeRef.current);
            totalSamplesScheduled += float32.length;
            const effectiveSpeed = speedRef?.current ?? 1;
            streamNextTimeRef.current =
              scheduleStartTime + totalSamplesScheduled / (sampleRate * effectiveSpeed);
          }
        }

        // --- Generator exhausted ---

        // Flush remaining PCM (last partial chunk)
        if (header && pcmCarry.length >= header.bytesPerSample) {
          const alignedLen =
            Math.floor(pcmCarry.length / header.bytesPerSample) * header.bytesPerSample;
          const pcmSlice = pcmCarry.slice(0, alignedLen);
          const float32 = pcmToFloat32(pcmSlice, header) as Float32Array<ArrayBuffer>;

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

          if (firstChunk) {
            scheduleStartTime = ctx.currentTime + 0.025;
            streamNextTimeRef.current = scheduleStartTime;
          }

          source.start(streamNextTimeRef.current);
          totalSamplesScheduled += float32.length;
          const effectiveSpeed = speedRef?.current ?? 1;
          streamNextTimeRef.current =
            scheduleStartTime + totalSamplesScheduled / (sampleRate * effectiveSpeed);
        }

        // Wire playback-end detection on the last scheduled source.
        // Each source's onended already handles cleanup (splice from array).
        // The last source additionally fires onPlaybackEndRef and resolves.
        const sources = streamingSourcesRef.current;
        const lastSource = sources.length > 0 ? sources[sources.length - 1] : null;

        if (lastSource) {
          const existingOnEnded = lastSource.onended;
          lastSource.onended = (ev) => {
            // Run the cleanup handler first (splice from array)
            existingOnEnded?.call(lastSource, ev);
            playPromiseResolveRef.current = null;
            signal?.removeEventListener('abort', onAbort);
            if (!stoppingRef.current) {
              onPlaybackEndRef.current?.();
            }
            resolvePlayback();
          };
        } else {
          // No audio was produced
          playPromiseResolveRef.current = null;
          signal?.removeEventListener('abort', onAbort);
          if (!stoppingRef.current) {
            onPlaybackEndRef.current?.();
          }
          resolvePlayback();
        }
      } catch (err) {
        signal?.removeEventListener('abort', onAbort);
        for (const src of streamingSourcesRef.current) {
          try {
            src.stop();
          } catch {
            /* ignore */
          }
        }
        streamingSourcesRef.current = [];
        playPromiseResolveRef.current = null;
        rejectPlayback(err);
      }

      return playbackPromise;
    },
    [getContext]
  );

  /**
   * Play a sequence of audio buffers back-to-back (sentence-level pipelined TTS).
   * All promises are started in parallel but played in order.
   * Only fires onPlaybackEnd after the last buffer finishes.
   */
  const playAudioSequence = useCallback(
    async (audioPromises: Promise<ArrayBuffer>[], signal?: AbortSignal): Promise<void> => {
      if (audioPromises.length === 0) return;

      const ctx = getContext();
      if (!ctx) throw new Error('AudioContext unavailable — cannot play audio sequence');
      if (ctx.state === 'suspended') await ctx.resume();

      // Stop any current playback
      try {
        sourceRef.current?.stop();
      } catch {
        // ignore
      }
      for (const src of streamingSourcesRef.current) {
        try {
          src.stop();
        } catch {
          /* ignore */
        }
      }
      streamingSourcesRef.current = [];
      playPromiseResolveRef.current?.();
      playPromiseResolveRef.current = null;

      for (let i = 0; i < audioPromises.length; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const arrayBuf = await audioPromises[i];
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const buffer = await ctx.decodeAudioData(arrayBuf.slice(0));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        if (speedRef) source.playbackRate.value = speedRef.current;
        source.connect(gainRef.current!);
        sourceRef.current = source;

        const isLast = i === audioPromises.length - 1;

        await new Promise<void>((resolve, reject) => {
          playPromiseResolveRef.current = resolve;

          const onAbort = () => {
            try {
              source.stop();
            } catch {
              /* ignore */
            }
            sourceRef.current = null;
            playPromiseResolveRef.current = null;
            reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });

          source.onended = () => {
            signal?.removeEventListener('abort', onAbort);
            sourceRef.current = null;
            playPromiseResolveRef.current = null;
            if (isLast && !stoppingRef.current) {
              onPlaybackEndRef.current?.();
            }
            resolve();
          };
          source.start();
        });
      }
    },
    [getContext]
  );

  const getAmplitude = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return sum / (data.length * 255);
  }, []);

  /**
   * Reset PCM chunk scheduling counters.
   * Call this when starting a new response to ensure the first chunk
   * gets a fresh timing baseline.
   */
  const resetPcmSchedule = useCallback(() => {
    pcmScheduleStartRef.current = 0;
    pcmTotalSamplesRef.current = 0;
    pcmNextTimeRef.current = 0;
    pcmFirstChunkRef.current = true;
    pcmBufferQueueRef.current.reset();
  }, []);

  /**
   * Play a raw PCM chunk received over WebSocket.
   * Converts the ArrayBuffer to Float32, creates an AudioBuffer, and schedules
   * it with sample-exact timing for gapless playback.
   *
   * @param pcm Raw PCM bytes (Float32 little-endian, i.e. 4 bytes per sample)
   * @param sampleRate Sample rate of the PCM data (e.g. 24000)
   */
  /**
   * Schedule a single PCM chunk for playback.
   * Handles Int16→Float32 conversion and sample-exact timing.
   */
  const schedulePcmChunk = useCallback(
    (chunk: ArrayBuffer, sampleRate: number, ctx: AudioContext): void => {
      // TTS sends 16-bit Int16 PCM — convert to Float32 [-1, 1] for Web Audio API
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
    },
    [speedRef],
  );

  /**
   * Play a raw PCM chunk received over WebSocket.
   * Buffers N chunks before scheduling to prevent choppy playback.
   */
  const playPcmChunk = useCallback(
    (pcm: ArrayBuffer, sampleRate: number): void => {
      const ctx = getContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume(); // fire-and-forget
      }

      const chunksToSchedule = pcmBufferQueueRef.current.push(pcm);
      if (chunksToSchedule.length === 0) return; // still buffering

      for (const chunk of chunksToSchedule) {
        schedulePcmChunk(chunk, sampleRate, ctx);
      }
    },
    [getContext, schedulePcmChunk],
  );

  /**
   * Signal that no more PCM chunks will arrive for this response.
   * Flushes any buffered chunks and wires onPlaybackEnd to the last
   * scheduled AudioBufferSourceNode. Without this, playPcmChunk has no
   * way to know when playback is complete — onPlaybackEnd never fires
   * and the UI stays stuck on AI_SPEAKING.
   */
  const finalizePcmPlayback = useCallback(
    (sampleRate: number) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      // Flush any remaining buffered chunks
      const remaining = pcmBufferQueueRef.current.flush();
      for (const chunk of remaining) {
        schedulePcmChunk(chunk, sampleRate, ctx);
      }

      // Wire onPlaybackEnd to the last scheduled source
      const sources = streamingSourcesRef.current;
      const lastSource = sources.length > 0 ? sources[sources.length - 1] : null;

      if (lastSource) {
        const existingOnEnded = lastSource.onended;
        lastSource.onended = (ev) => {
          existingOnEnded?.call(lastSource, ev);
          if (!stoppingRef.current) {
            onPlaybackEndRef.current?.();
          }
        };
      } else {
        // No audio was scheduled — fire immediately
        if (!stoppingRef.current) {
          onPlaybackEndRef.current?.();
        }
      }
    },
    [schedulePcmChunk],
  );

  useEffect(() => {
    return () => {
      try {
        sourceRef.current?.stop();
      } catch {
        // ignore
      }
      for (const src of streamingSourcesRef.current) {
        try {
          src.stop();
        } catch {
          /* ignore */
        }
      }
      streamingSourcesRef.current = [];
      playPromiseResolveRef.current?.();
      playPromiseResolveRef.current = null;
      audioCtxRef.current?.close();
    };
  }, []);

  return {
    playAudio,
    playAudioSequence,
    playStreamingAudio,
    playPcmChunk,
    finalizePcmPlayback,
    resetPcmSchedule,
    stopAudio,
    suspendPlayback,
    resumePlayback,
    getAmplitude,
    initContext,
    applyVolume,
    analyser: analyserNode,
  };
}
