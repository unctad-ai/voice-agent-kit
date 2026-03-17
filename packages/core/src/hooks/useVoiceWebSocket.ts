import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceWebSocketManager } from '../services/voiceWebSocket';
import type {
  ServerEvent,
  ClientState,
  ConversationItemCreatedEvent,
  ResponseTextDeltaEvent,
  ResponseTextDoneEvent,
  ToolCallEvent,
  SttResultEvent,
  StatusEvent,
  VoiceErrorEvent,
  TimingsEvent,
} from '../protocol/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceWebSocketStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export interface VoiceWebSocketMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SttResult {
  text: string;
  noSpeechProb: number;
  avgLogprob: number;
}

export interface UseVoiceWebSocketOptions {
  url: string;
  siteConfig: unknown;
  clientState?: ClientState;
  voiceSettings?: unknown;
  language?: string;
  onToolCall?: (name: string, args: unknown) => Promise<unknown>;
  onAudio?: (data: ArrayBuffer) => void;
  onPlaybackDone?: () => void;
  onTimings?: (timings: TimingsEvent) => void;
}

export interface UseVoiceWebSocketReturn {
  status: VoiceWebSocketStatus;
  messages: VoiceWebSocketMessage[];
  isConnected: boolean;
  connect: (conversation?: unknown[]) => void;
  disconnect: () => void;
  sendAudio: (pcm: Float32Array) => void;
  commitAudio: () => void;
  cancelResponse: () => void;
  clearAudio: () => void;
  sendSessionUpdate: (clientState: ClientState) => void;
  sttResult: SttResult | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceWebSocket({
  url,
  siteConfig,
  clientState: clientStateProp,
  voiceSettings,
  language,
  onToolCall,
  onAudio,
  onPlaybackDone,
  onTimings,
}: UseVoiceWebSocketOptions): UseVoiceWebSocketReturn {
  const [status, setStatus] = useState<VoiceWebSocketStatus>('idle');
  const [messages, setMessages] = useState<VoiceWebSocketMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sttResult, setSttResult] = useState<SttResult | null>(null);

  const managerRef = useRef<VoiceWebSocketManager | null>(null);
  const pendingTextRef = useRef('');

  // Stable callback refs to avoid stale closures
  const onToolCallRef = useRef(onToolCall);
  useEffect(() => { onToolCallRef.current = onToolCall; });
  const onAudioRef = useRef(onAudio);
  useEffect(() => { onAudioRef.current = onAudio; });
  const onPlaybackDoneRef = useRef(onPlaybackDone);
  useEffect(() => { onPlaybackDoneRef.current = onPlaybackDone; });
  const onTimingsRef = useRef(onTimings);
  useEffect(() => { onTimingsRef.current = onTimings; });

  const connect = useCallback(
    (conversation: unknown[] = []) => {
      // Close existing connection
      managerRef.current?.close();

      const manager = new VoiceWebSocketManager(url);
      managerRef.current = manager;

      // --- Event handlers ---

      manager.onEvent('session.created', () => {
        setIsConnected(true);
      });

      manager.onEvent('status', (event: StatusEvent) => {
        const statusMap: Record<string, VoiceWebSocketStatus> = {
          listening: 'listening',
          processing: 'processing',
          speaking: 'speaking',
          idle: 'idle',
        };
        const mapped = statusMap[event.status];
        if (mapped) setStatus(mapped);
      });

      manager.onEvent('conversation.item.created', (event: ConversationItemCreatedEvent) => {
        setMessages((prev) => [
          ...prev,
          { role: event.item.role, content: event.item.content },
        ]);
      });

      manager.onEvent('response.text.delta', (event: ResponseTextDeltaEvent) => {
        pendingTextRef.current += event.delta;
      });

      manager.onEvent('response.text.done', (event: ResponseTextDoneEvent) => {
        pendingTextRef.current = '';
        // Update the last assistant message with the final text
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
            const updated = [...prev];
            updated[lastIdx] = { ...updated[lastIdx], content: event.text };
            return updated;
          }
          return [...prev, { role: 'assistant', content: event.text }];
        });
      });

      manager.onEvent('response.audio.done', () => {
        onPlaybackDoneRef.current?.();
      });

      manager.onEvent('stt.result', (event: SttResultEvent) => {
        setSttResult({
          text: event.transcript,
          noSpeechProb: 0,
          avgLogprob: 0,
        });
      });

      manager.onEvent('tool.call', async (event: ToolCallEvent) => {
        if (!onToolCallRef.current) return;
        try {
          const args = JSON.parse(event.arguments);
          const result = await onToolCallRef.current(event.name, args);
          manager.sendEvent('tool.result', {
            tool_call_id: event.tool_call_id,
            result,
          });
        } catch (err) {
          console.error('[useVoiceWebSocket] Tool call error:', err);
          manager.sendEvent('tool.result', {
            tool_call_id: event.tool_call_id,
            result: { error: err instanceof Error ? err.message : String(err) },
          });
        }
      });

      manager.onEvent('error', (event: VoiceErrorEvent) => {
        console.error('[useVoiceWebSocket] Server error:', event.code, event.message);
        setStatus('error');
      });

      manager.onEvent('timings', (event: TimingsEvent) => {
        onTimingsRef.current?.(event);
      });

      // Binary audio handler
      manager.onAudio((data: ArrayBuffer) => {
        onAudioRef.current?.(data);
      });

      // Connect
      manager.connect({
        conversation,
        config: siteConfig,
        clientState: clientStateProp,
        voice_settings: voiceSettings,
        language,
      });
    },
    [url, siteConfig, clientStateProp, voiceSettings, language],
  );

  const disconnect = useCallback(() => {
    managerRef.current?.close();
    managerRef.current = null;
    setIsConnected(false);
    setStatus('idle');
  }, []);

  const sendAudio = useCallback((pcm: Float32Array) => {
    managerRef.current?.sendAudio(pcm);
  }, []);

  const commitAudio = useCallback(() => {
    managerRef.current?.sendEvent('input_audio_buffer.commit');
  }, []);

  const cancelResponse = useCallback(() => {
    managerRef.current?.sendEvent('response.cancel');
  }, []);

  const clearAudio = useCallback(() => {
    managerRef.current?.sendEvent('input_audio_buffer.clear');
  }, []);

  const sendSessionUpdate = useCallback((cs: ClientState) => {
    managerRef.current?.sendEvent('session.update', { clientState: cs });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      managerRef.current?.close();
      managerRef.current = null;
    };
  }, []);

  return {
    status,
    messages,
    isConnected,
    connect,
    disconnect,
    sendAudio,
    commitAudio,
    cancelResponse,
    clearAudio,
    sendSessionUpdate,
    sttResult,
  };
}
