import { parseServerEvent, type ServerEvent, type ClientState } from '../protocol/events';

/** WebSocket connection state machine — mirrors server-side WsState. */
enum WsState { CONNECTING, OPEN, CLOSING, CLOSED }

/**
 * WebSocket connection manager for the voice pipeline.
 * Uses a state machine (CONNECTING → OPEN → CLOSING → CLOSED) to guard
 * all send/close operations and prevent crashes on invalid states.
 *
 * Handles binary (audio) and text (JSON events) messages,
 * automatic reconnection with exponential backoff, and
 * session restoration on reconnect.
 */
export class VoiceWebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private state: WsState = WsState.CLOSED;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private eventHandlers = new Map<string, Set<(payload: any) => void>>();
  private audioHandler: ((data: ArrayBuffer) => void) | null = null;
  private lastSessionData: {
    conversation: unknown[];
    config: unknown;
    clientState?: ClientState;
    voice_settings?: unknown;
    language?: string;
  } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Open the WebSocket and send an initial session.update event.
   */
  connect(sessionData: {
    conversation: unknown[];
    config: unknown;
    clientState?: ClientState;
    voice_settings?: unknown;
    language?: string;
  }): void {
    this.lastSessionData = sessionData;
    this._open();
  }

  private _open(): void {
    if (this.state !== WsState.CLOSED) return;

    this.state = WsState.CONNECTING;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';
    } catch (err) {
      this.state = WsState.CLOSED;
      console.error('[VoiceWS] Failed to create WebSocket:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.state = WsState.OPEN;
      this.reconnectDelay = 1000; // Reset backoff on successful connect
      // Send session data
      if (this.lastSessionData) {
        this.sendEvent('session.update', {
          conversation: this.lastSessionData.conversation,
          config: this.lastSessionData.config,
          clientState: this.lastSessionData.clientState,
          voice_settings: this.lastSessionData.voice_settings,
          language: this.lastSessionData.language,
        });
      }
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        // Binary frame = audio data
        this.audioHandler?.(ev.data);
        return;
      }

      // Text frame = JSON event
      const event = parseServerEvent(ev.data as string);
      if (!event) return;

      const handlers = this.eventHandlers.get(event.type);
      if (handlers) {
        for (const handler of handlers) {
          handler(event);
        }
      }

      // Also fire wildcard handlers
      const wildcardHandlers = this.eventHandlers.get('*');
      if (wildcardHandlers) {
        for (const handler of wildcardHandlers) {
          handler(event);
        }
      }
    };

    this.ws.onclose = () => {
      this.state = WsState.CLOSED;
      this.ws = null;
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[VoiceWS] WebSocket error:', err);
      // onclose will fire after onerror, triggering reconnect
    };
  }

  private _scheduleReconnect(): void {
    if (this.state !== WsState.CLOSED || this.reconnectTimer) return;

    console.log(`[VoiceWS] Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  /**
   * Send raw PCM audio as a binary WebSocket frame.
   * Guarded by state machine — silently drops if not OPEN.
   */
  sendAudio(pcm: Float32Array): void {
    if (this.state !== WsState.OPEN || !this.ws) return;
    // Send only the relevant slice — pcm.buffer may be larger than the view
    // (e.g. when pcm comes from OfflineAudioContext.getChannelData())
    this.ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  }

  /**
   * Send a JSON event over the WebSocket.
   * Guarded by state machine — silently drops if not OPEN.
   */
  sendEvent(type: string, payload?: Record<string, unknown>): void {
    if (this.state !== WsState.OPEN || !this.ws) return;
    this.ws.send(JSON.stringify({ type, ...payload }));
  }

  /**
   * Register an event handler for a specific server event type.
   * Use '*' to listen to all events.
   * Returns an unsubscribe function.
   */
  onEvent(type: string, handler: (payload: any) => void): () => void {
    let handlers = this.eventHandlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(type, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.eventHandlers.delete(type);
      }
    };
  }

  /**
   * Register a handler for binary audio data from the server.
   * Returns an unsubscribe function.
   */
  onAudio(handler: (data: ArrayBuffer) => void): () => void {
    this.audioHandler = handler;
    return () => {
      if (this.audioHandler === handler) {
        this.audioHandler = null;
      }
    };
  }

  /**
   * Close the WebSocket and stop reconnection attempts.
   */
  close(): void {
    this.state = WsState.CLOSED;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    this.eventHandlers.clear();
    this.audioHandler = null;
    this.lastSessionData = null;
  }

  /**
   * Whether the WebSocket is currently connected and open.
   */
  get isConnected(): boolean {
    return this.state === WsState.OPEN;
  }
}

/**
 * Perform a simple health check against the voice pipeline endpoint.
 * Attempts a WebSocket handshake to verify the server accepts connections.
 */
export async function checkPipelineHealth(
  url: string,
): Promise<{ connected: boolean }> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        resolve({ connected: false });
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        resolve({ connected: true });
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve({ connected: false });
      };
    } catch {
      resolve({ connected: false });
    }
  });
}

/**
 * Build the default WebSocket URL for the voice pipeline.
 * Uses VITE_BACKEND_URL if available, otherwise derives from window.location.
 */
function buildDefaultWsUrl(): string {
  const backendUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';
  if (backendUrl) {
    const wsUrl = backendUrl.replace(/^http/, 'ws');
    return `${wsUrl}/api/voice`;
  }
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/voice`;
  }
  return 'ws://localhost:3001/api/voice';
}

/**
 * Convenience health check that auto-builds the WebSocket URL.
 * Returns the same shape as the old checkLLMHealth for backward compatibility.
 */
export async function checkBackendHealth(): Promise<{ available: boolean; message?: string }> {
  const url = buildDefaultWsUrl();
  const { connected } = await checkPipelineHealth(url);
  if (connected) return { available: true };
  return { available: false, message: 'Voice pipeline unreachable' };
}
