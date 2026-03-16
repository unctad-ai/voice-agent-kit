import { useCallback, useEffect, useRef, useState } from 'react';
import { useTenVAD } from './useTenVAD';
import { useNavigate, useLocation, useParams } from 'react-router';
import { useUIActionRegistry, useFormFieldRegistry, createClientToolHandler } from '@unctad-ai/voice-agent-registries';
import { useVoiceWebSocket } from './useVoiceWebSocket';
import { useAudioPlayback } from './useAudioPlayback';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import type { VoiceState, VoiceMessage } from '../types/voice';
import type { VoiceErrorType } from '../types/errors';
import type { VoiceSettings } from '../types/settings';
import type { TimingsEvent } from '../protocol/events';
import {
  BARGE_IN,
  GUARD_DELAY_MS,
  MISFIRE_DISMISS_MS,
  LLM_ERROR_DISMISS_MS,
  MIC_TOGGLE_DEBOUNCE_MS,
  VAD,
  SILENT_MARKER,
  ACTION_BADGE_CONFIG,
  UNINTERRUPTIBLE_WINDOW_MS,
} from '../config/defaults';

// ---------------------------------------------------------------------------
// Text sanitization helpers
// ---------------------------------------------------------------------------

/**
 * Strip reasoning-model chain-of-thought from LLM output.
 * Handles both tagged (<think>...</think>) and untagged CoT.
 */
function stripChainOfThought(raw: string): string {
  let text = raw;

  // Tagged CoT: <think>...</think>
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Untagged CoT: reasoning paragraphs before the actual answer
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) {
    const reasoningPatterns =
      /\b(we need to|we should|we must|according to rules|the user says|ensure no|two sentences|under \d+ words|no markdown|no contractions|let me think|so we|that'?s \d+ sentences)\b/i;
    const hasReasoning = paragraphs.slice(0, -1).some((p) => reasoningPatterns.test(p));
    if (hasReasoning) {
      text = paragraphs[paragraphs.length - 1];
    }
  }

  return text.trim();
}

/** Strip markdown formatting and LLM artifacts for the transcript panel. */
function sanitizeForTranscript(raw: string): string {
  return (
    stripChainOfThought(raw)
      .replace(/\|[^\n]+\|/g, '')
      .replace(/^\s*[-|: ]+$/gm, '')
      .replace(/^\s*[-\u2013\u2022*]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      // Strip bracketed stage directions ([Awaiting response], [thinking], etc.)
      .replace(/\[[^\]]{2,}\]/g, '')
      .replace(/\n{2,}/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/\.{2,}/g, '.')
      .replace(/\.\s*\./g, '.')
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Pipeline timing instrumentation
// ---------------------------------------------------------------------------
export interface PipelineTimings {
  pipeline: 'voice' | 'text';
  speechDurationMs?: number;
  wavSizeBytes?: number;
  wavEncodeMs?: number;
  sttMs?: number;
  sttRetries?: number;
  llmSendMs?: number;
  llmWaitMs?: number;
  llmTotalMs?: number;
  ttsMs?: number;
  ttsFirstChunkMs?: number;
  ttsTotalMs?: number;
  playbackMs?: number;
  totalMs: number;
  timestamp: number;
}

function logTimings(t: PipelineTimings) {
  const rows: Record<string, string> = {};
  if (t.speechDurationMs != null) rows['Speech duration'] = `${t.speechDurationMs.toFixed(0)} ms`;
  if (t.wavSizeBytes != null) rows['WAV size'] = `${(t.wavSizeBytes / 1024).toFixed(1)} KB`;
  if (t.wavEncodeMs != null) rows['WAV encode'] = `${t.wavEncodeMs.toFixed(1)} ms`;
  if (t.sttMs != null)
    rows['STT'] = `${t.sttMs.toFixed(0)} ms${t.sttRetries ? ` (${t.sttRetries} retries)` : ''}`;
  if (t.llmSendMs != null) rows['LLM send'] = `${t.llmSendMs.toFixed(0)} ms`;
  if (t.llmWaitMs != null) rows['LLM wait'] = `${t.llmWaitMs.toFixed(0)} ms`;
  if (t.llmTotalMs != null) rows['LLM total'] = `${t.llmTotalMs.toFixed(0)} ms`;
  if (t.ttsFirstChunkMs != null) rows['TTS first chunk'] = `${t.ttsFirstChunkMs.toFixed(0)} ms`;
  if (t.ttsTotalMs != null) rows['TTS total'] = `${t.ttsTotalMs.toFixed(0)} ms`;
  if (t.ttsMs != null) rows['TTS (buffered)'] = `${t.ttsMs.toFixed(0)} ms`;
  if (t.playbackMs != null) rows['Playback'] = `${t.playbackMs.toFixed(0)} ms`;
  rows['TOTAL'] = `${t.totalMs.toFixed(0)} ms`;

  console.group(
    `%c\u23f1 Voice Pipeline [${t.pipeline}] \u2014 ${t.totalMs.toFixed(0)} ms`,
    'color: #4fc3f7; font-weight: bold'
  );
  console.table(rows);
  console.groupEnd();
}

export interface UseVoiceAgentOptions {
  bargeInEnabled?: boolean;
  /** Voice settings -- injected from host app's VoiceSettingsContext */
  settings: VoiceSettings;
  /** Ref tracking current volume (updated by settings provider) */
  volumeRef: React.RefObject<number>;
  /** Ref tracking current playback speed (updated by settings provider) */
  speedRef: React.RefObject<number>;
}

function classifyError(err: unknown): VoiceErrorType {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'mic_denied';
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'mic_unavailable';
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('STT') || msg.includes('Transcription')) return 'stt_failed';
  if (msg.includes('TTS') || msg.includes('synthesis')) return 'tts_failed';
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch'))
    return 'network_error';
  if (msg.includes('chat') || msg.includes('LLM')) return 'llm_failed';
  return 'network_error';
}

// ---------------------------------------------------------------------------
// Audio frame buffer + resample helpers
// ---------------------------------------------------------------------------

/**
 * Buffer for accumulating 5 VAD frames before resampling and sending.
 * 5 x 256 samples at 16kHz = 1280 samples (~80ms of audio).
 */
const FRAMES_PER_SEND = 5;
const SAMPLES_PER_FRAME = 256;
const SOURCE_RATE = 16000;
const TARGET_RATE = 24000;

/**
 * Resample Float32 PCM from sourceRate to targetRate using OfflineAudioContext.
 * Returns a Promise<Float32Array> with the resampled data.
 */
async function resample16kTo24k(input: Float32Array): Promise<Float32Array> {
  const inputDuration = input.length / SOURCE_RATE;
  const outputLength = Math.ceil(inputDuration * TARGET_RATE);
  const offlineCtx = new OfflineAudioContext(1, outputLength, TARGET_RATE);
  const buffer = offlineCtx.createBuffer(1, input.length, SOURCE_RATE);
  buffer.copyToChannel(input as Float32Array<ArrayBuffer>, 0);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/** VAD tuning config */
const VAD_CONFIG = VAD;

// Module-level set -- survives React component remounts (route changes)
const processedToolCalls = new Set<string>();

// ---------------------------------------------------------------------------
// Build WebSocket URL from current page
// ---------------------------------------------------------------------------

function buildWebSocketUrl(): string {
  const backendUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';
  if (backendUrl) {
    // Convert http(s) URL to ws(s)
    const wsUrl = backendUrl.replace(/^http/, 'ws');
    return `${wsUrl}/api/voice`;
  }
  // Default: same origin, WebSocket
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/voice`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceAgent({
  bargeInEnabled = true,
  settings,
  volumeRef,
  speedRef,
}: UseVoiceAgentOptions) {
  const config = useSiteConfig();

  const [state, setState] = useState<VoiceState>('IDLE');
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<VoiceErrorType>(null);
  const [lastTimings, setLastTimings] = useState<PipelineTimings | null>(null);

  // Transient LLM error -- shows briefly then auto-clears
  const setTransientLLMError = useCallback(() => {
    setVoiceError('llm_failed');
    setTimeout(() => {
      setVoiceError((prev) => (prev === 'llm_failed' ? null : prev));
    }, LLM_ERROR_DISMISS_MS);
  }, []);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const lastToggleRef = useRef(0);
  const bargeInFrames = useRef(0);
  /** Two-phase barge-in: mute first, confirm speech before destroying response */
  const bargeInPendingRef = useRef(false);
  const playbackEndedDuringBargeInRef = useRef(false);
  /** Tracks whether the current pipeline was initiated via text input */
  const textPipelineRef = useRef(false);
  /** Whether we are in the middle of a turn (processing server response) */
  const processingRef = useRef(false);
  /** Timestamp when AI started speaking (for uninterruptible window) */
  const aiSpeakingStartRef = useRef(0);

  // Audio frame buffer for accumulating VAD frames
  const audioFrameBufferRef = useRef<Float32Array[]>([]);

  // --- Client tool handling ---
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { actions: uiActions, execute: executeUIAction } = useUIActionRegistry();
  const formRegistry = useFormFieldRegistry();

  const handleClientTool = createClientToolHandler({
    navigate,
    executeUIAction: executeUIAction as (
      actionId: string,
      params?: Record<string, unknown>
    ) => string | undefined | Promise<string | undefined>,
    getFormFields: () => formRegistry.fields,
    setFormValue: formRegistry.setValue,
    config,
  });

  const CLIENT_TOOLS = new Set([
    'navigateTo',
    'viewService',
    'startApplication',
    'performUIAction',
    'getFormSchema',
    'fillFormFields',
  ]);
  const NAVIGATION_TOOLS = ['navigateTo', 'viewService', 'startApplication'];
  const actionSeqRef = useRef(0);

  // --- Audio playback ---
  const {
    playPcmChunk,
    resetPcmSchedule,
    stopAudio,
    suspendPlayback,
    resumePlayback,
    getAmplitude,
    initContext,
    applyVolume,
    analyser,
  } = useAudioPlayback({
    volumeRef,
    speedRef,
    onPlaybackEnd: () => {
      if (bargeInPendingRef.current) {
        playbackEndedDuringBargeInRef.current = true;
        return;
      }
      if (stateRef.current === 'AI_SPEAKING') {
        const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
        textPipelineRef.current = false;
        setTimeout(() => {
          if (stateRef.current === 'AI_SPEAKING') {
            setState(nextState);
          }
        }, GUARD_DELAY_MS);
      }
    },
  });

  /**
   * Resume TTS playback after a false barge-in (noise was not real speech).
   */
  const resumeFromBargeIn = useCallback(() => {
    if (stateRef.current === 'IDLE' || !bargeInPendingRef.current) return;
    bargeInPendingRef.current = false;
    if (playbackEndedDuringBargeInRef.current) {
      playbackEndedDuringBargeInRef.current = false;
      resumePlayback();
      const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
      textPipelineRef.current = false;
      stateRef.current = nextState;
      setState(nextState);
    } else {
      resumePlayback();
      stateRef.current = 'AI_SPEAKING';
      setState('AI_SPEAKING');
    }
  }, [resumePlayback]);

  // --- WebSocket voice pipeline ---
  const wsUrl = useRef(buildWebSocketUrl()).current;

  const voiceWs = useVoiceWebSocket({
    url: wsUrl,
    siteConfig: config,
    voiceSettings: {
      ttsEnabled: settings.ttsEnabled,
      expressiveness: settings.expressiveness,
      responseLength: settings.responseLength,
    },
    language: settings.language,
    onToolCall: async (name: string, args: unknown) => {
      const tcId = `ws-${name}-${Date.now()}`;

      // Emit action badge
      const badgeConfig = ACTION_BADGE_CONFIG[name];
      if (badgeConfig) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'action',
            text: badgeConfig.label,
            timestamp: Date.now() + ++actionSeqRef.current * 0.001,
            action: { name, category: badgeConfig.category },
          },
        ]);
      }

      // Only handle client-side tools
      if (!CLIENT_TOOLS.has(name)) {
        return undefined;
      }

      // Wait for React to flush state for form schema reads
      if (name === 'getFormSchema') {
        await new Promise((r) => requestAnimationFrame(r));
      }

      const result = await handleClientTool(
        name,
        args as Record<string, unknown>,
      );

      // Wait for navigation to settle
      if (NAVIGATION_TOOLS.includes(name)) {
        await new Promise((r) => requestAnimationFrame(r));
      }

      // Update the action badge with the result snippet
      if (badgeConfig && result) {
        let resultSnippet: string = result;
        if (resultSnippet.length > 40) {
          const truncated = resultSnippet.slice(0, 40);
          const lastSpace = truncated.lastIndexOf(' ');
          resultSnippet =
            (lastSpace > 15 ? truncated.slice(0, lastSpace) : truncated).trimEnd() + '\u2026';
        }
        const label = `${badgeConfig.label} \u00b7 ${resultSnippet}`;
        setMessages((prev) => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'action' && (prev[i] as any).action?.name === name) {
              idx = i;
              break;
            }
          }
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            text: label,
            action: { name, category: badgeConfig.category, result: resultSnippet },
          };
          return updated;
        });
      }

      return result;
    },
    onAudio: (data: ArrayBuffer) => {
      // Play PCM chunks as they arrive from the server (24kHz Int16 PCM)
      if (stateRef.current === 'PROCESSING') {
        // First audio chunk: transition to AI_SPEAKING
        resetPcmSchedule();
        stateRef.current = 'AI_SPEAKING';
        setState('AI_SPEAKING');
        aiSpeakingStartRef.current = Date.now();
      }
      if (stateRef.current === 'AI_SPEAKING') {
        playPcmChunk(data, TARGET_RATE);
      }
    },
    onPlaybackDone: () => {
      // response.audio.done: server finished sending audio chunks.
      // Do NOT transition to LISTENING here — audio is still playing from
      // scheduled AudioBuffers. The onPlaybackEnd callback in useAudioPlayback
      // fires when the last AudioBufferSourceNode.onended triggers, which is
      // the correct signal. Transitioning here causes the mic to go live while
      // TTS is still audible, creating a feedback loop.
      //
      // If we're still in PROCESSING (LLM returned [SILENT] or empty), transition
      // since there's no audio to wait for.
      if (stateRef.current === 'PROCESSING') {
        const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
        textPipelineRef.current = false;
        stateRef.current = nextState;
        setState(nextState);
        processingRef.current = false;
      }
      // Safety net: if onPlaybackEnd never fires (buffer underrun, no audio
      // scheduled, AudioContext issue), force transition after 10s so the UI
      // never gets stuck on "Speaking..." forever.
      if (stateRef.current === 'AI_SPEAKING') {
        setTimeout(() => {
          if (stateRef.current === 'AI_SPEAKING') {
            const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
            textPipelineRef.current = false;
            stateRef.current = nextState;
            setState(nextState);
            processingRef.current = false;
          }
        }, 10_000);
      }
    },
    onTimings: (event: TimingsEvent) => {
      const timings: PipelineTimings = {
        pipeline: 'voice',
        sttMs: event.stt_ms,
        llmTotalMs: event.llm_ms,
        ttsMs: event.tts_ms,
        totalMs: event.total_ms ?? 0,
        timestamp: Date.now(),
      };
      logTimings(timings);
      setLastTimings(timings);
    },
  });

  // Track WebSocket status -> voice state mapping
  useEffect(() => {
    switch (voiceWs.status) {
      case 'listening':
        // Server returned to listening (e.g. after Filtered/empty STT result).
        // Transition client back so it doesn't get stuck in PROCESSING.
        if (stateRef.current === 'PROCESSING') {
          const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
          textPipelineRef.current = false;
          stateRef.current = nextState;
          setState(nextState);
          processingRef.current = false;
        }
        break;
      case 'processing':
        if (stateRef.current !== 'PROCESSING' && stateRef.current !== 'AI_SPEAKING') {
          setState('PROCESSING');
        }
        break;
      case 'speaking':
        if (stateRef.current !== 'AI_SPEAKING') {
          resetPcmSchedule();
          stateRef.current = 'AI_SPEAKING';
          setState('AI_SPEAKING');
        }
        break;
      case 'error':
        setTransientLLMError();
        break;
    }
  }, [voiceWs.status, resetPcmSchedule, setTransientLLMError]);

  // Update transcript and messages from WebSocket conversation items
  useEffect(() => {
    const wsMessages = voiceWs.messages;
    if (wsMessages.length === 0) return;

    const last = wsMessages[wsMessages.length - 1];
    if (last.role === 'user') {
      setCurrentTranscript(last.content);
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: last.content, timestamp: Date.now() },
      ]);
    } else if (last.role === 'assistant') {
      const cleaned = sanitizeForTranscript(last.content);

      // Silent rejection
      if (cleaned?.includes(SILENT_MARKER)) {
        console.debug('[VoiceAgent] LLM returned SILENT marker, skipping');
        // Remove the assistant [SILENT] message AND the user message that triggered it
        setMessages((prev) => {
          // First remove the last message (assistant [SILENT])
          const withoutAssistant = prev.length > 0 ? prev.slice(0, -1) : prev;
          // Then find and remove the last user message that triggered this turn
          let lastUserIdx = -1;
          for (let i = withoutAssistant.length - 1; i >= 0; i--) {
            if (withoutAssistant[i].role === 'user') { lastUserIdx = i; break; }
          }
          if (lastUserIdx === -1) return withoutAssistant;
          return [...withoutAssistant.slice(0, lastUserIdx), ...withoutAssistant.slice(lastUserIdx + 1)];
        });
        setVoiceError('not_addressed');
        setTimeout(() => {
          setVoiceError((prev) => (prev === 'not_addressed' ? null : prev));
        }, MISFIRE_DISMISS_MS);
        if (stateRef.current === 'PROCESSING') {
          const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
          textPipelineRef.current = false;
          stateRef.current = nextState;
          setState(nextState);
        }
        return;
      }

      if (cleaned) {
        setCurrentTranscript(cleaned);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: cleaned, timestamp: Date.now() },
        ]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceWs.messages.length]);

  // --- Audio frame buffering + resampling ---
  const handleRawAudio = useCallback(
    (pcm: Float32Array) => {
      // Turn boundary: only send audio when LISTENING or USER_SPEAKING
      if (stateRef.current !== 'LISTENING' && stateRef.current !== 'USER_SPEAKING') return;

      audioFrameBufferRef.current.push(pcm);

      if (audioFrameBufferRef.current.length >= FRAMES_PER_SEND) {
        const frames = audioFrameBufferRef.current;
        audioFrameBufferRef.current = [];

        // Merge frames into a single buffer
        const totalSamples = frames.reduce((s, f) => s + f.length, 0);
        const merged = new Float32Array(totalSamples);
        let offset = 0;
        for (const frame of frames) {
          merged.set(frame, offset);
          offset += frame.length;
        }

        // Resample 16kHz -> 24kHz and send
        resample16kTo24k(merged).then((resampled) => {
          voiceWs.sendAudio(resampled);
        }).catch((err) => {
          console.warn('[VoiceAgent] Resample failed:', err);
          // Fallback: send at 16kHz
          voiceWs.sendAudio(merged);
        });
      }
    },
    [voiceWs],
  );

  // --- Barge-in ---
  const handleBargeIn = useCallback(() => {
    if (!bargeInPendingRef.current) {
      playbackEndedDuringBargeInRef.current = false;
    }
    bargeInPendingRef.current = true;
    suspendPlayback();
    voiceWs.cancelResponse();
    stateRef.current = 'USER_SPEAKING';
    setState('USER_SPEAKING');
    bargeInFrames.current = 0;
  }, [suspendPlayback, voiceWs]);

  const handleBargeInRef = useRef(handleBargeIn);
  useEffect(() => {
    handleBargeInRef.current = handleBargeIn;
  });

  // --- Speech end (VAD segment complete) ---
  const handleSpeechEnd = useCallback(
    (audio: Float32Array) => {
      if (stateRef.current !== 'USER_SPEAKING' && stateRef.current !== 'LISTENING') return;

      const wasBargeIn = bargeInPendingRef.current;

      // Check audio energy
      let sumSq = 0;
      for (let i = 0; i < audio.length; i++) sumSq += audio[i] * audio[i];
      const rms = Math.sqrt(sumSq / audio.length);

      if (rms < settingsRef.current.minAudioRms) {
        console.debug(`[VoiceAgent] Audio too quiet (RMS=${rms.toFixed(4)}), discarding`);
        if (wasBargeIn) {
          resumeFromBargeIn();
        } else {
          setState('LISTENING');
        }
        return;
      }

      // Confirmed speech
      if (wasBargeIn) {
        bargeInPendingRef.current = false;
        playbackEndedDuringBargeInRef.current = false;
        stopAudio();
      }

      // Commit the audio buffer to the server — triggers STT + LLM + TTS pipeline
      voiceWs.commitAudio();
      setState('PROCESSING');
      setCurrentTranscript('');
      processingRef.current = true;
    },
    [voiceWs, stopAudio, resumeFromBargeIn],
  );

  const handleSpeechEndRef = useRef(handleSpeechEnd);
  useEffect(() => {
    handleSpeechEndRef.current = handleSpeechEnd;
  });

  // --- VAD ---
  const vad = useTenVAD({
    startOnLoad: false,
    ...VAD_CONFIG,
    positiveSpeechThreshold: settings.speechThreshold,
    negativeSpeechThreshold: Math.max(0.1, settings.speechThreshold - 0.25),
    redemptionMs: settings.pauseToleranceMs,

    onRawAudio: (pcm: Float32Array) => {
      handleRawAudio(pcm);
    },

    onSpeechStart: () => {
      if (stateRef.current === 'LISTENING') {
        setState('USER_SPEAKING');
      }
    },

    onSpeechEnd: (audio: Float32Array) => {
      handleSpeechEndRef.current(audio);
    },

    onVADMisfire: () => {
      if (bargeInPendingRef.current) {
        console.debug('[VoiceAgent] False barge-in (VAD misfire), resuming TTS');
        resumeFromBargeIn();
        return;
      }
      if (stateRef.current === 'USER_SPEAKING') {
        setState('LISTENING');
        setVoiceError('speech_too_short');
        setTimeout(() => {
          setVoiceError((prev) => (prev === 'speech_too_short' ? null : prev));
        }, MISFIRE_DISMISS_MS);
      }
    },

    onFrameProcessed: (probabilities) => {
      if (bargeInEnabled && stateRef.current === 'AI_SPEAKING') {
        // Uninterruptible window: suppress barge-in for first N ms after TTS starts
        const elapsed = Date.now() - aiSpeakingStartRef.current;
        if (elapsed < UNINTERRUPTIBLE_WINDOW_MS) return;

        if (
          probabilities.isSpeech > settings.bargeInThreshold &&
          probabilities.rms >= settings.minAudioRms
        ) {
          bargeInFrames.current++;
          if (bargeInFrames.current >= BARGE_IN.framesRequired) {
            handleBargeInRef.current();
          }
        } else {
          bargeInFrames.current = 0;
        }
      }
    },
  });

  // Detect VAD errors
  useEffect(() => {
    if (vad.errored) {
      const errMsg =
        typeof vad.errored === 'object' && 'message' in vad.errored
          ? (vad.errored as { message: string }).message
          : String(vad.errored);
      if (errMsg.includes('Permission') || errMsg.includes('NotAllowed')) {
        setVoiceError('mic_denied');
      } else if (errMsg.includes('NotFound') || errMsg.includes('no audio')) {
        setVoiceError('mic_unavailable');
      } else {
        setVoiceError('vad_load_failed');
      }
    }
  }, [vad.errored]);

  const dismissError = useCallback(() => setVoiceError(null), []);

  // --- Start / Stop ---
  const start = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleRef.current < MIC_TOGGLE_DEBOUNCE_MS) return;
    lastToggleRef.current = now;

    processingRef.current = false;
    setVoiceError(null);
    setMessages([]);
    setCurrentTranscript('');
    actionSeqRef.current = 0;
    processedToolCalls.clear();
    audioFrameBufferRef.current = [];

    // Connect WebSocket
    voiceWs.connect([]);

    setState('LISTENING');
    vad.start();
  }, [vad, voiceWs]);

  const stop = useCallback(
    (force?: boolean) => {
      if (!force) {
        const now = Date.now();
        if (now - lastToggleRef.current < MIC_TOGGLE_DEBOUNCE_MS) return;
        lastToggleRef.current = now;
      }
      stopAudio();
      processingRef.current = false;
      bargeInPendingRef.current = false;
      playbackEndedDuringBargeInRef.current = false;
      audioFrameBufferRef.current = [];
      vad.pause();
      voiceWs.disconnect();
      setState('IDLE');
    },
    [vad, stopAudio, voiceWs],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      processingRef.current = false;
    };
  }, [stopAudio]);

  // --- Text input pipeline (sends text over WebSocket) ---
  const sendTextMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      if (processingRef.current) {
        setVoiceError('processing');
        setTimeout(() => {
          setVoiceError((prev) => (prev === 'processing' ? null : prev));
        }, MISFIRE_DISMISS_MS);
        return;
      }
      processingRef.current = true;
      textPipelineRef.current = true;

      setMessages((prev) => [...prev, { role: 'user', text, timestamp: Date.now() }]);
      setCurrentTranscript(text);
      setState('PROCESSING');

      // For text messages, we don't use the WebSocket audio pipeline.
      // Instead we add the user message to the session and commit.
      // The server-side session.update includes the conversation,
      // so we send a text-only turn through the WebSocket.
      // The WebSocket protocol handles this via session.update + commit.
      if (!voiceWs.isConnected) {
        voiceWs.connect([]);
        // Wait briefly for connection
        await new Promise((r) => setTimeout(r, 500));
      }

      // Send user text as a session update with the text in the conversation
      voiceWs.sendAudio(new Float32Array(0)); // no-op, but needed to trigger
      voiceWs.commitAudio();

      // The response will come through the WebSocket event handlers
      // and update state/messages via the effects above.
    },
    [voiceWs],
  );

  // Safety net: if WebSocket is idle but voice state is stuck on PROCESSING
  useEffect(() => {
    if (voiceWs.status === 'idle' && stateRef.current === 'PROCESSING') {
      const timer = setTimeout(() => {
        if (voiceWs.status === 'idle' && stateRef.current === 'PROCESSING') {
          console.warn('[VoiceAgent] Recovering from stale PROCESSING state');
          const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
          textPipelineRef.current = false;
          stateRef.current = nextState;
          setState(nextState);
          processingRef.current = false;
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [voiceWs.status, state]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    start,
    stop,
    loading: vad.loading,
    error: vad.errored,
    voiceError,
    dismissError,
    messages,
    currentTranscript,
    isLLMLoading: voiceWs.status === 'processing',
    getAmplitude,
    initContext,
    applyVolume,
    analyser,
    sendTextMessage,
    lastTimings,
    settings,
  };
}
