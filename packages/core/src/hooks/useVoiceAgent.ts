import { useCallback, useEffect, useRef, useState } from 'react';
import { useTenVAD } from './useTenVAD';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useNavigate, useLocation, useParams } from 'react-router';
import { useUIActionRegistry, useFormFieldRegistry, createClientToolHandler } from '@unctad-ai/voice-agent-registries';
import { float32ToWav } from '../utils/audioUtils';
import {
  transcribeAudio,
  synthesizeSpeech,
  streamSpeech,
  checkLLMHealth,
} from '../services/voiceApi';
import { useAudioPlayback } from './useAudioPlayback';
import { useSiteConfig } from '../contexts/SiteConfigContext';
import type { VoiceState, VoiceMessage } from '../types/voice';
import type { VoiceErrorType } from '../types/errors';
import type { VoiceSettings } from '../types/settings';
import {
  BARGE_IN,
  GUARD_DELAY_MS,
  MAX_STT_RETRIES,
  RETRY_BASE_DELAY_MS,
  MISFIRE_DISMISS_MS,
  LLM_ERROR_DISMISS_MS,
  MAX_NO_SPEECH_PROB,
  MIN_AVG_LOGPROB,
  MIC_TOGGLE_DEBOUNCE_MS,
  PIPELINE_TIMEOUT_MS,
  VAD,
  SILENT_MARKER,
  END_SESSION_MARKER,
  ACTION_BADGE_CONFIG,
} from '../config/defaults';

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
      .replace(/^\s*[-–•*]\s+/gm, '')
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

/** Known Whisper hallucinations on near-silent audio */
const WHISPER_HALLUCINATIONS = new Set([
  'thank you.',
  'thank you',
  'thank you for watching.',
  'thank you for watching',
  'thanks.',
  'thanks',
  'thanks for watching.',
  'thanks for watching',
  'bye.',
  'bye',
  'goodbye.',
  'goodbye',
  "you're welcome.",
  "you're welcome",
  'hmm.',
  'hmm',
  'huh.',
  'huh',
  'oh.',
  'oh',
  'ah.',
  'ah',
  'uh.',
  'uh',
  'so.',
  'so',
  'well.',
  'you',
  'the end.',
  'the end',
  'subtitle',
  'subtitles',
  'subscribe',
  'like and subscribe',
  'sort of',
  'sort of.',
  'five.',
  'five',
  'one.',
  'one',
  'two.',
  'two',
  'three.',
  'three',
  // Non-speech sounds Whisper transcribes literally
  'cough',
  'cough.',
  'coughing',
  'coughing.',
  'sigh',
  'sigh.',
  'clap',
  'clap.',
  'click',
  'click.',
  'knock',
  'knock.',
  // Common non-English hallucinations
  'продолжение следует',
  'продолжение следует...',
  'sous-titres',
  'sous-titrage',
  'merci.',
  'merci',
  'silencio',
  'ready for your approval.',
]);

/** Compute RMS energy of Float32 audio buffer */
function computeRMS(audio: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < audio.length; i++) {
    sum += audio[i] * audio[i];
  }
  return Math.sqrt(sum / audio.length);
}

/**
 * Split text into sentences for pipelined TTS.
 * Fires one TTS request per sentence in parallel so the first sentence
 * plays within ~1s while subsequent sentences are still generating.
 * Merges short fragments (< 8 words) with the previous sentence to
 * avoid tiny TTS requests that produce choppy audio.
 */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(/(?<=[.!?])\s+/);
  const sentences = parts.map((s) => s.trim()).filter((s) => s.length > 0);

  if (sentences.length <= 1) return sentences.length > 0 ? sentences : [trimmed];

  const merged: string[] = [];
  for (const s of sentences) {
    if (merged.length > 0 && merged[merged.length - 1].split(/\s+/).length < 8) {
      merged[merged.length - 1] += ' ' + s;
    } else {
      merged.push(s);
    }
  }

  return merged;
}

/** VAD tuning config — imported from centralized voice config */
const VAD_CONFIG = VAD;

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
    `%c⏱ Voice Pipeline [${t.pipeline}] — ${t.totalMs.toFixed(0)} ms`,
    'color: #4fc3f7; font-weight: bold'
  );
  console.table(rows);
  console.groupEnd();
}

export interface UseVoiceAgentOptions {
  bargeInEnabled?: boolean;
  /** Voice settings — injected from host app's VoiceSettingsContext */
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

// Module-level set — survives React component remounts (route changes) which
// destroy refs, but correctly resets on full page navigation (new module load).
// This prevents the onToolCall replay bug where the SDK re-fires callbacks for
// tool invocations already present in the messages after a component remount.
const processedToolCalls = new Set<string>();

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

  // Transient LLM error — shows briefly then auto-clears so the user can retry.
  // Unlike network_error (persistent offline), tool_use_failed is intermittent.
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

  // Ref for settings — avoids stale closures in useCallback bodies
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const abortRef = useRef<AbortController | null>(null);
  const bargeInFrames = useRef(0);
  const sttRetryCount = useRef(0);
  const lastToggleRef = useRef(0);
  const processingRef = useRef(false);
  /** Tracks whether the current pipeline was initiated via text input */
  const textPipelineRef = useRef(false);

  /** Two-phase barge-in: mute first, confirm speech before destroying TTS */
  const bargeInPendingRef = useRef(false);
  /** If TTS playback ends while barge-in is pending, we can't resume audio */
  const playbackEndedDuringBargeInRef = useRef(false);
  /** When true, close after current TTS finishes (LLM sent [END_SESSION]) */
  const sessionEndingRef = useRef(false);
  /** Signals the panel to close after farewell TTS played */
  const [sessionEnded, setSessionEnded] = useState(false);

  // --- Vercel AI SDK: useChat replaces CopilotKit ---
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

  const roundTripCountRef = useRef(0);
  const lastAutoSendMsgIdRef = useRef<string | null>(null);
  const MAX_CLIENT_ROUND_TRIPS = 25;
  const NAVIGATION_TOOLS = ['navigateTo', 'viewService', 'startApplication'];
  // Client tools have no server-side `execute` — the client must provide results.
  // Server tools (searchServices, getServiceDetails, etc.) are already executed
  // server-side; their results arrive in the stream and must NOT be overwritten.
  const CLIENT_TOOLS = new Set([
    'navigateTo',
    'viewService',
    'startApplication',
    'performUIAction',
    'getFormSchema',
    'fillFormFields',
  ]);
  const actionSeqRef = useRef(0);

  const {
    messages: chatMessages,
    setMessages: setChatMessages,
    status: chatStatus,
    stop: chatStop,
    sendMessage: chatSendMessage,
    addToolOutput: chatAddToolOutput,
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      headers: (): Record<string, string> => {
        const apiKey = import.meta.env.VITE_API_KEY;
        return apiKey ? { 'X-API-Key': apiKey } : {};
      },
      body: () => ({
        maxHistoryMessages: settingsRef.current.maxHistoryMessages,
        clientState: {
          route: location.pathname,
          currentService: params.serviceId
            ? (() => {
                const s = config.services.find(sv => sv.id === params.serviceId);
                return s ? { id: s.id, title: s.title, category: s.category } : null;
              })()
            : null,
          categories: config.categories.map((c) => ({
            category: c.title,
            count: c.services.length,
          })),
          uiActions:
            uiActions.length > 0
              ? uiActions.map((a: any) => ({
                  id: a.id,
                  description: a.description,
                  category: a.category,
                  params: a.params,
                }))
              : [],
          formStatus:
            formRegistry.fields.length > 0
              ? {
                  fieldCount: formRegistry.fields.length,
                  groups: [
                    ...new Set(formRegistry.fields.map((f: any) => f.group).filter(Boolean)),
                  ] as string[],
                }
              : null,
        },
      }),
    }),
    // Auto-send a follow-up request after all client tool outputs are provided.
    // This runs after addToolOutput updates a tool part — when every tool
    // invocation in the last assistant message has resolved, the SDK sends the
    // results back to the model for the next step.
    sendAutomaticallyWhen({ messages: msgs }) {
      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) return false;
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return false;
      // Dedup key includes resolved tool count so successive client-tool
      // round-trips on the same assistant message are not blocked.
      const resolvedToolParts = (last as any).parts?.filter(
        (p: any) => p.type?.startsWith?.('tool-') && p.state === 'output-available',
      ).length ?? 0;
      const sendKey = `${(last as any).id}:${resolvedToolParts}`;
      if (sendKey === lastAutoSendMsgIdRef.current) return false;
      // Use the SDK's own check: filters providerExecuted (server) tools,
      // respects step boundaries, and verifies all client tool parts are resolved.
      const complete = lastAssistantMessageIsCompleteWithToolCalls({ messages: msgs });
      if (complete) {
        lastAutoSendMsgIdRef.current = sendKey;
        roundTripCountRef.current++;
        console.debug('[sendAutomaticallyWhen] follow-up #' + roundTripCountRef.current);
        return true;
      }
      return false;
    },
    onFinish({ message, isAbort }) {
      if (isAbort) return; // Don't trigger TTS on aborted requests
      // onFinish fires per HTTP response, not per user turn.
      // Guard: only trigger TTS when there is actual text content.
      const textParts = (message.parts || []).filter((p: any) => p.type === 'text');
      const text = textParts.map((p: any) => p.text || '').join('');
      if (!text) return; // Intermediate response with only tool calls

      // NOTE: Do NOT reset roundTripCountRef here — onFinish fires per HTTP
      // response (including auto-send follow-ups). Resetting here would defeat
      // the round-trip guard and allow infinite loops. The counter resets when
      // the USER sends a new message (in sendTextMessage / voice pipeline).
      const cleaned = sanitizeForTranscript(text);

      // Silent rejection — remove the user message (assistant was never added)
      if (cleaned?.includes(SILENT_MARKER)) {
        console.debug('[VoiceAgent] LLM returned SILENT marker, skipping TTS');
        setMessages((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
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

      // Session end
      let ttsText = cleaned || '';
      if (text.includes(END_SESSION_MARKER)) {
        ttsText = config.farewellMessage;
        sessionEndingRef.current = true;
      }

      // Update transcript
      if (ttsText) {
        setCurrentTranscript(ttsText);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: ttsText, timestamp: Date.now() },
        ]);
      }

      // TTS
      if (ttsText && ttsText !== SILENT_MARKER && stateRef.current === 'PROCESSING') {
        stateRef.current = 'AI_SPEAKING';
        setState('AI_SPEAKING');

        const curSettings = settingsRef.current;

        // TTS disabled — skip synthesis
        if (!curSettings.ttsEnabled) {
          const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
          textPipelineRef.current = false;
          stateRef.current = nextState;
          setState(nextState);
          return;
        }

        const doTTS = async () => {
          const ttsParams = {
            temperature: curSettings.expressiveness,
            maxWords: curSettings.responseLength,
          };
          abortRef.current = new AbortController();
          try {
            const stream = streamSpeech(
              ttsText,
              abortRef.current.signal,
              ttsParams,
              curSettings.ttsTimeoutMs
            );
            if (stateRef.current === 'AI_SPEAKING') {
              await playStreamingAudio(stream, abortRef.current.signal);
            }
          } catch (streamErr) {
            if ((streamErr as Error).name !== 'AbortError') {
              console.warn('Streaming TTS failed, falling back to buffered:', streamErr);
              try {
                if (!abortRef.current) throw new DOMException('Aborted', 'AbortError');
                const sentences = splitSentences(ttsText);
                for (const sentence of sentences) {
                  if (abortRef.current.signal.aborted) break;
                  if (stateRef.current !== 'AI_SPEAKING') break;
                  const audio = await synthesizeSpeech(
                    sentence,
                    abortRef.current.signal,
                    ttsParams,
                    curSettings.ttsTimeoutMs
                  );
                  if (stateRef.current !== 'AI_SPEAKING') break;
                  await playAudio(audio);
                }
              } catch (fbErr) {
                if ((fbErr as Error).name !== 'AbortError') {
                  console.error('TTS failed:', fbErr);
                  setVoiceError('tts_failed');
                  setTimeout(() => {
                    if (stateRef.current === 'AI_SPEAKING') {
                      const ns = textPipelineRef.current ? 'IDLE' : 'LISTENING';
                      textPipelineRef.current = false;
                      setState(ns);
                    }
                  }, 2000);
                }
              }
            }
          }
        };
        doTTS();
      } else if (stateRef.current === 'PROCESSING') {
        // No TTS needed (empty or silent) — go back to listening
        const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
        textPipelineRef.current = false;
        stateRef.current = nextState;
        setState(nextState);
      }
    },
    async onToolCall({ toolCall }) {
      // Guard: skip tool calls we've already processed. The SDK fires onToolCall
      // for every tool invocation in the messages array on each re-render, not
      // just new ones. Without this guard, historical tool calls replay and
      // flood sendAutomaticallyWhen with spurious evaluations.
      const tcId = toolCall.toolCallId;
      if (processedToolCalls.has(tcId)) return;
      processedToolCalls.add(tcId);

      const isClientTool = CLIENT_TOOLS.has(toolCall.toolName);

      // Emit action badge for all tools (server and client)
      const badgeConfig = ACTION_BADGE_CONFIG[toolCall.toolName];
      if (badgeConfig) {
        // For server tools, just show the label — result is handled server-side.
        // For client tools, we'll update the badge after execution.
        setMessages((prev) => [
          ...prev,
          {
            role: 'action',
            text: badgeConfig.label,
            timestamp: Date.now() + ++actionSeqRef.current * 0.001,
            action: { name: toolCall.toolName, category: badgeConfig.category },
          },
        ]);
      }

      // Only handle client-side tools — server tools already have results
      // from the stream and must not be overwritten via addToolOutput.
      if (!isClientTool) return;

      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) {
        console.warn(
          `[VoiceAgent] Client round-trip limit reached (${roundTripCountRef.current}/${MAX_CLIENT_ROUND_TRIPS})`
        );
        // Provide a synthetic tool output so the SDK doesn't hang waiting for it.
        // The model will see this and can respond to the user instead of stalling.
        chatAddToolOutput({
          toolCallId: toolCall.toolCallId,
          tool: toolCall.toolName,
          output: JSON.stringify({
            error: 'Round-trip limit reached. Ask the user to continue with the next step.',
          }),
        });
        return;
      }

      // Wait for React to flush state for form schema reads
      if (toolCall.toolName === 'getFormSchema') {
        await new Promise((r) => requestAnimationFrame(r));
      }

      const result = await handleClientTool(
        toolCall.toolName,
        toolCall.input as Record<string, unknown>
      );

      // Wait for navigation to settle
      if (NAVIGATION_TOOLS.includes(toolCall.toolName)) {
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
          // Replace the last action badge for this tool with the updated one
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'action' && (prev[i] as any).action?.name === toolCall.toolName) {
              idx = i;
              break;
            }
          }
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            text: label,
            action: { name: toolCall.toolName, category: badgeConfig.category, result: resultSnippet },
          };
          return updated;
        });
      }

      // Provide the tool output to the SDK. Fire-and-forget (no await) because
      // onToolCall runs inside the Chat jobExecutor — awaiting addToolOutput
      // here would deadlock. The queued job runs after the current transform
      // finishes, updates the tool part to "output-available", and triggers
      // sendAutomaticallyWhen to send a follow-up request.
      chatAddToolOutput({
        toolCallId: toolCall.toolCallId,
        tool: toolCall.toolName,
        output: result,
      });
    },
  });

  const {
    playAudio,
    playStreamingAudio,
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
      // If barge-in is pending (audio muted while we verify noise vs speech),
      // record that playback ended so resumeFromBargeIn knows not to unmute.
      if (bargeInPendingRef.current) {
        playbackEndedDuringBargeInRef.current = true;
        return;
      }
      if (stateRef.current === 'AI_SPEAKING') {
        // LLM included [END_SESSION] — farewell just played, close the session
        if (sessionEndingRef.current) {
          sessionEndingRef.current = false;
          textPipelineRef.current = false;
          stateRef.current = 'IDLE';
          setState('IDLE');
          setSessionEnded(true);
          return;
        }
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
   * Unfreezes the AudioContext so all paused sources continue from where they
   * stopped. If audio ended during the brief async suspension race window,
   * transitions normally instead.
   */
  const resumeFromBargeIn = useCallback(() => {
    // Guard: if the agent was stopped (IDLE) or barge-in was already resolved,
    // don't resurrect state — stop() clears bargeInPendingRef.
    if (stateRef.current === 'IDLE' || !bargeInPendingRef.current) return;

    bargeInPendingRef.current = false;
    if (playbackEndedDuringBargeInRef.current) {
      // Audio ended during the async suspension window — transition normally
      playbackEndedDuringBargeInRef.current = false;
      resumePlayback();
      const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
      textPipelineRef.current = false;
      stateRef.current = nextState;
      setState(nextState);
    } else {
      // Audio still frozen — unfreeze and continue playback
      resumePlayback();
      stateRef.current = 'AI_SPEAKING';
      setState('AI_SPEAKING');
    }
  }, [resumePlayback]);

  const handleSpeechEnd = useCallback(
    async (audio: Float32Array) => {
      if (stateRef.current !== 'USER_SPEAKING' && stateRef.current !== 'LISTENING') return;

      // Reset session-ending flag so a barge-in during farewell TTS doesn't
      // cause premature session close on the next turn.
      sessionEndingRef.current = false;

      const wasBargeIn = bargeInPendingRef.current;

      // Block concurrent pipelines — but allow barge-in noise processing
      // even when the first pipeline still holds processingRef.
      if (processingRef.current && !wasBargeIn) return;

      // Energy gate BEFORE entering PROCESSING — quiet audio should not
      // reset the idle timer or trigger any visible state change.
      const rms = computeRMS(audio);
      if (rms < settingsRef.current.minAudioRms) {
        console.debug(`[VoiceAgent] Audio too quiet (RMS=${rms.toFixed(4)}), discarding`);
        if (wasBargeIn) {
          console.debug('[VoiceAgent] False barge-in (RMS gate), resuming TTS');
          resumeFromBargeIn();
        } else {
          setState('LISTENING');
        }
        return;
      }

      // Track whether we "own" processingRef — during barge-in the first
      // pipeline already holds it and its finally block will clean up.
      let ownProcessing = !processingRef.current;
      processingRef.current = true;
      // Only abort previous TTS if this is NOT a pending barge-in.
      // For barge-in, we defer the abort until we confirm it's real speech.
      if (!wasBargeIn) {
        abortRef.current?.abort();
        abortRef.current = null;
      }

      // Clear any lingering error from previous attempt (e.g. "Didn't catch that")
      setVoiceError(null);
      // During barge-in, defer PROCESSING state and transcript clear until we've
      // confirmed real speech — avoids flicker if it turns out to be noise.
      if (!wasBargeIn) {
        setState('PROCESSING');
        setCurrentTranscript('');
      }

      roundTripCountRef.current = 0; // Reset for new user turn
      lastAutoSendMsgIdRef.current = null;

      const t0 = performance.now();
      const timings: Partial<PipelineTimings> = {
        pipeline: 'voice',
        speechDurationMs: (audio.length / 16000) * 1000,
        timestamp: Date.now(),
      };

      // End-to-end pipeline timeout — prevents hanging due to network or GPU issues
      const pipelineAc = new AbortController();
      const pipelineTimer = setTimeout(() => pipelineAc.abort(), PIPELINE_TIMEOUT_MS);

      try {
        // 1. Convert to WAV and transcribe (with retry)
        const tWav0 = performance.now();
        const wavBlob = float32ToWav(audio, 16000);
        timings.wavEncodeMs = performance.now() - tWav0;
        timings.wavSizeBytes = wavBlob.size;

        let text: string | undefined;
        let noSpeechProb = 0;
        let avgLogprob = 0;
        let sttRetries = 0;
        const tStt0 = performance.now();

        for (let attempt = 0; attempt <= MAX_STT_RETRIES; attempt++) {
          try {
            const result = await transcribeAudio(
              wavBlob,
              undefined,
              settingsRef.current.sttTimeoutMs,
              settingsRef.current.language,
            );
            text = result.text;
            noSpeechProb = result.noSpeechProb ?? 0;
            avgLogprob = result.avgLogprob ?? 0;
            sttRetryCount.current = 0;
            break;
          } catch {
            sttRetries = attempt + 1;
            if (attempt < MAX_STT_RETRIES) {
              await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * (attempt + 1)));
            } else {
              timings.sttMs = performance.now() - tStt0;
              timings.sttRetries = sttRetries;
              timings.totalMs = performance.now() - t0;
              logTimings(timings as PipelineTimings);
              setLastTimings(timings as PipelineTimings);
              if (wasBargeIn) {
                console.debug('[VoiceAgent] False barge-in (STT failed), resuming TTS');
                resumeFromBargeIn();
              } else {
                setVoiceError('stt_failed');
                setTimeout(() => {
                  setVoiceError((prev) => (prev === 'stt_failed' ? null : prev));
                }, MISFIRE_DISMISS_MS);
                setState('LISTENING');
              }
              return;
            }
          }
        }
        timings.sttMs = performance.now() - tStt0;
        timings.sttRetries = sttRetries;

        // Pipeline timeout check — bail after STT if we've exceeded the budget
        if (pipelineAc.signal.aborted) {
          console.warn('[VoiceAgent] Pipeline timeout after STT');
          timings.totalMs = performance.now() - t0;
          logTimings(timings as PipelineTimings);
          setLastTimings(timings as PipelineTimings);
          setState('LISTENING');
          return;
        }

        // Filter out non-speech using Whisper's quality signals:
        // - no_speech_prob: model's estimate that segment contains no speech
        // - avg_logprob: mean token confidence (more negative = less sure)
        // Coughs/noise produce no_speech_prob ≈ 0 but avg_logprob ≈ -0.9
        if (noSpeechProb > MAX_NO_SPEECH_PROB || avgLogprob < MIN_AVG_LOGPROB) {
          console.debug(
            `[VoiceAgent] Low-confidence STT (no_speech_prob=${noSpeechProb.toFixed(3)}, avg_logprob=${avgLogprob.toFixed(3)}), discarding`
          );
          timings.totalMs = performance.now() - t0;
          logTimings(timings as PipelineTimings);
          setLastTimings(timings as PipelineTimings);
          if (wasBargeIn) {
            console.debug('[VoiceAgent] False barge-in (low STT confidence), resuming TTS');
            resumeFromBargeIn();
          } else {
            setState('LISTENING');
          }
          return;
        }

        // Filter out Whisper ghost transcriptions:
        // 1. Punctuation/symbol-only output (e.g. ".", "...", "!")
        // 2. Known hallucinated phrases on near-silent audio (e.g. "Thank you.")
        const trimmed = (text ?? '').trim();
        const cleaned = trimmed.replace(/[\s\p{P}\p{S}]+/gu, '');
        const isGhost = cleaned.length === 0 || WHISPER_HALLUCINATIONS.has(trimmed.toLowerCase());
        if (!text || isGhost) {
          console.debug('[VoiceAgent] Discarded ghost transcription:', JSON.stringify(text));
          timings.totalMs = performance.now() - t0;
          logTimings(timings as PipelineTimings);
          setLastTimings(timings as PipelineTimings);
          if (wasBargeIn) {
            console.debug('[VoiceAgent] False barge-in (ghost transcription), resuming TTS');
            resumeFromBargeIn();
          } else {
            setState('LISTENING');
          }
          return;
        }

        // Confirmed real speech — if this was a barge-in, now fully stop the old TTS
        if (wasBargeIn) {
          console.debug('[VoiceAgent] Barge-in confirmed (real speech), stopping old TTS');
          bargeInPendingRef.current = false;
          playbackEndedDuringBargeInRef.current = false;
          stopAudio();
          abortRef.current?.abort();
          abortRef.current = null;

          // Now safe to show PROCESSING state — speech is real, not noise
          setState('PROCESSING');
          setCurrentTranscript('');

          // The old pipeline was aborted above — take ownership of processingRef
          // so this pipeline processes the barge-in speech instead of dropping it.
          // Previously this returned to LISTENING, forcing the user to repeat.
          if (!ownProcessing) {
            ownProcessing = true;
          }
        }

        // Store user message
        setCurrentTranscript(text);
        setMessages((prev) => [
          ...prev,
          { role: 'user', text: text as string, timestamp: Date.now() },
        ]);

        // 2. Send to LLM via useChat — response handled in onFinish callback
        const tLlm0 = performance.now();
        try {
          await chatSendMessage({ text: text as string });
        } catch (llmErr) {
          console.error('LLM error:', llmErr);
          timings.llmSendMs = performance.now() - tLlm0;
          timings.totalMs = performance.now() - t0;
          logTimings(timings as PipelineTimings);
          setLastTimings(timings as PipelineTimings);
          setTransientLLMError();
          setState('LISTENING');
          return;
        }
        timings.llmSendMs = performance.now() - tLlm0;
        // TTS is handled by onFinish callback — no need to await response here

        timings.totalMs = performance.now() - t0;
        logTimings(timings as PipelineTimings);
        setLastTimings(timings as PipelineTimings);
      } catch (err) {
        timings.totalMs = performance.now() - t0;
        logTimings(timings as PipelineTimings);
        setLastTimings(timings as PipelineTimings);
        if ((err as Error).name !== 'AbortError') {
          console.error('Voice agent error:', err);
          setVoiceError(classifyError(err));
        }
        const s = stateRef.current as VoiceState;
        if (s === 'PROCESSING' || s === 'AI_SPEAKING') {
          setState('LISTENING');
        }
      } finally {
        clearTimeout(pipelineTimer);
        if (ownProcessing) processingRef.current = false;
      }
    },
    [chatSendMessage, playAudio, playStreamingAudio, stopAudio, resumePlayback, resumeFromBargeIn]
  );

  const handleBargeIn = useCallback(() => {
    // Phase 1: freeze the AudioContext instead of destroying playback.
    // All scheduled sources pause in place. New TTS chunks continue to be
    // scheduled on the frozen context and play seamlessly when resumed.
    // If the noise turns out to be real speech, we fully stop in handleSpeechEnd.
    // If it's noise, we unfreeze via resumeFromBargeIn() — zero content loss.

    // Set flags BEFORE suspending — during the async suspension window,
    // onPlaybackEnd may fire; it needs bargeInPendingRef to be true.
    // Only reset playbackEndedDuringBargeInRef if this is a fresh barge-in,
    // not a duplicate — avoids wiping a "playback ended" signal from the first.
    if (!bargeInPendingRef.current) {
      playbackEndedDuringBargeInRef.current = false;
    }
    bargeInPendingRef.current = true;
    suspendPlayback();
    stateRef.current = 'USER_SPEAKING';
    setState('USER_SPEAKING');
    bargeInFrames.current = 0;
  }, [suspendPlayback]);

  // Stable callback refs for useTenVAD (avoids re-creating the hook)
  const handleSpeechEndRef = useRef(handleSpeechEnd);
  useEffect(() => {
    handleSpeechEndRef.current = handleSpeechEnd;
  });

  const handleBargeInRef = useRef(handleBargeIn);
  useEffect(() => {
    handleBargeInRef.current = handleBargeIn;
  });

  const vad = useTenVAD({
    startOnLoad: false,
    ...VAD_CONFIG,
    // Override with user settings
    positiveSpeechThreshold: settings.speechThreshold,
    negativeSpeechThreshold: Math.max(0.1, settings.speechThreshold - 0.25),
    redemptionMs: settings.pauseToleranceMs,

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
        // Require both speech probability AND sufficient energy to barge in.
        // Without the RMS gate, quiet sounds (speaker bleed, ambient noise)
        // trigger barge-in via VAD probability alone, interrupting playback.
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

  // Detect VAD errors (mic denied, model load failure)
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

  const start = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleRef.current < MIC_TOGGLE_DEBOUNCE_MS) return;
    lastToggleRef.current = now;
    // Abort any running pipeline to prevent ghost state transitions
    abortRef.current?.abort();
    abortRef.current = null;
    processingRef.current = false;
    setVoiceError(null);
    setMessages([]);
    setCurrentTranscript('');
    sessionEndingRef.current = false;
    setSessionEnded(false);
    setChatMessages([]);
    roundTripCountRef.current = 0;
    actionSeqRef.current = 0;
    processedToolCalls.clear();
    setState('LISTENING');
    vad.start();

    // Non-blocking LLM health check — warn user early if AI service is down
    checkLLMHealth().then(({ available, message }) => {
      if (!available) {
        console.warn('[VoiceAgent] LLM unavailable:', message);
        setVoiceError('llm_failed');
      }
    });
  }, [vad, setChatMessages]);

  const stop = useCallback(
    (force?: boolean) => {
      if (!force) {
        const now = Date.now();
        if (now - lastToggleRef.current < MIC_TOGGLE_DEBOUNCE_MS) return;
        lastToggleRef.current = now;
      }
      stopAudio(); // also clears suspension state
      abortRef.current?.abort();
      processingRef.current = false;
      bargeInPendingRef.current = false;
      playbackEndedDuringBargeInRef.current = false;
      sessionEndingRef.current = false;
      vad.pause();
      setState('IDLE');
    },
    [vad, stopAudio]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      abortRef.current?.abort();
      processingRef.current = false;
    };
  }, [stopAudio]);

  // Text input pipeline (same flow as voice, minus STT)
  const sendTextMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      sessionEndingRef.current = false;
      if (processingRef.current) {
        setVoiceError('processing');
        setTimeout(() => {
          setVoiceError((prev) => (prev === 'processing' ? null : prev));
        }, MISFIRE_DISMISS_MS);
        return;
      }
      processingRef.current = true;
      textPipelineRef.current = true;
      roundTripCountRef.current = 0; // Reset for new user turn
      lastAutoSendMsgIdRef.current = null;

      const t0 = performance.now();
      const timings: Partial<PipelineTimings> = { pipeline: 'text', timestamp: Date.now() };

      setMessages((prev) => [...prev, { role: 'user', text, timestamp: Date.now() }]);
      setCurrentTranscript(text);
      setState('PROCESSING');

      const tLlm0 = performance.now();
      try {
        await chatSendMessage({ text });
      } catch (llmErr) {
        console.error('LLM error:', llmErr);
        timings.llmSendMs = performance.now() - tLlm0;
        timings.totalMs = performance.now() - t0;
        logTimings(timings as PipelineTimings);
        setLastTimings(timings as PipelineTimings);
        setTransientLLMError();
        setState('IDLE');
        processingRef.current = false;
        textPipelineRef.current = false;
        return;
      }
      timings.llmSendMs = performance.now() - tLlm0;
      // TTS handled by onFinish callback
      timings.totalMs = performance.now() - t0;
      logTimings(timings as PipelineTimings);
      setLastTimings(timings as PipelineTimings);
      processingRef.current = false;
    },
    [chatSendMessage]
  );

  // Safety net: if the SDK is idle (chatStatus === 'ready') but the voice state
  // is stuck on PROCESSING for too long, recover to IDLE. This catches edge
  // cases where sendAutomaticallyWhen fails to fire the next follow-up (e.g.
  // dedup race, server stream ending without text on the last response).
  useEffect(() => {
    if (chatStatus !== 'ready' || stateRef.current !== 'PROCESSING') return;
    const timer = setTimeout(() => {
      if (chatStatus === 'ready' && stateRef.current === 'PROCESSING') {
        console.warn('[VoiceAgent] Recovering from stale PROCESSING state (SDK is idle)');
        const nextState = textPipelineRef.current ? 'IDLE' : 'LISTENING';
        textPipelineRef.current = false;
        stateRef.current = nextState;
        setState(nextState);
        processingRef.current = false;
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [chatStatus, state]); // eslint-disable-line react-hooks/exhaustive-deps

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
    isLLMLoading: chatStatus === 'streaming' || chatStatus === 'submitted',
    getAmplitude,
    initContext,
    applyVolume,
    analyser,
    sendTextMessage,
    lastTimings,
    sessionEnded,
    settings,
  };
}
