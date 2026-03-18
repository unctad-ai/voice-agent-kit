import WebSocket from 'ws';
import { WsState, canSend, transitionTo } from './wsState.js';
import type { SessionLogger } from './logger.js';

export interface SttStreamCallbacks {
  onWord?: (text: string, tokenId: number) => void;
  onVad?: (probs: number[]) => void;
  onDone?: (text: string, vadProbs: number[], durationMs: number) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}


/**
 * WebSocket client for streaming audio to the Python STT service.
 *
 * Uses a state machine (CONNECTING → OPEN → CLOSING → CLOSED) to guard
 * all send/close operations and prevent crashes on invalid WebSocket states.
 *
 * - Sends raw PCM Float32 frames as binary WebSocket frames (no JSON wrapping)
 * - Sends JSON control messages: flush, reset
 * - Receives JSON messages: word, vad, done
 * - Auto-reconnects with exponential backoff (1s -> 2s -> 4s -> max 30s)
 */
export class SttStreamClient {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: SttStreamCallbacks;
  private logger?: SessionLogger;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private _state: WsState = WsState.CLOSED;

  constructor(url: string, callbacks: SttStreamCallbacks, logger?: SessionLogger) {
    this.url = url;
    this.callbacks = callbacks;
    this.logger = logger;
  }

  get state(): WsState {
    return this._state;
  }

  connect(): void {
    if (this._state !== WsState.CLOSED) return;

    this._state = WsState.CONNECTING;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.on('open', () => {
        this._state = transitionTo(this._state, WsState.OPEN);
        this.reconnectDelay = 1000; // reset backoff on successful connect
        this.callbacks.onConnected?.();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'done') {
            this.logger?.info('stt:raw-done', `"${msg.text || ''}" dur=${msg.duration_ms}ms`);
          }
          switch (msg.type) {
            case 'word':
              this.callbacks.onWord?.(msg.text, msg.token_id);
              break;
            case 'vad':
              this.callbacks.onVad?.(msg.probs);
              break;
            case 'done':
              this.callbacks.onDone?.(msg.text, msg.vad_probs, msg.duration_ms);
              break;
            default:
              break;
          }
        } catch {
          this.callbacks.onError?.(
            new Error(`Failed to parse STT message: ${data.toString().slice(0, 200)}`)
          );
        }
      });

      this.ws.on('error', (err: Error) => {
        this.callbacks.onError?.(err);
      });

      this.ws.on('close', () => {
        this._state = transitionTo(this._state, WsState.CLOSED);
        this.callbacks.onDisconnected?.();
        if (this._state === WsState.CLOSED && this.reconnectTimer === null) {
          this.scheduleReconnect();
        }
      });
    } catch (err) {
      this._state = WsState.CLOSED;
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error(String(err))
      );
      this.scheduleReconnect();
    }
  }

  /**
   * Send raw PCM Float32 audio as a binary WebSocket frame.
   * Silently drops frames if the connection is not open.
   */
  sendAudio(pcm: Float32Array): void {
    if (!canSend(this._state) || !this.ws) return;
    this.ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  /**
   * Tell the STT service to finalize the current utterance.
   */
  flush(): void {
    if (!canSend(this._state) || !this.ws) {
      this.logger?.warn('stt:flush-dropped', `state=${WsState[this._state]}`);
      return;
    }
    this.logger?.info('stt:flush');
    this.ws.send(JSON.stringify({ type: 'flush' }));
  }

  /**
   * Tell the STT service to discard state and start fresh.
   */
  reset(): void {
    if (!canSend(this._state) || !this.ws) return;
    this.ws.send(JSON.stringify({ type: 'reset' }));
  }

  /**
   * Permanently close the connection. No reconnect will be attempted.
   */
  close(): void {
    this._state = WsState.CLOSED;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.removeAllListeners();
      ws.on('error', () => {});          // absorb async errors emitted after close
      try { ws.close(); } catch { /* ignore */ }
    }
  }

  get isConnected(): boolean {
    return this._state === WsState.OPEN;
  }

  private scheduleReconnect(): void {
    if (this._state !== WsState.CLOSED || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._state = WsState.CLOSED; // Ensure clean state before reconnect
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: double the delay, capped at maxReconnectDelay
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }
}
