import WebSocket from 'ws';

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
 * - Sends raw PCM Float32 frames as binary WebSocket frames (no JSON wrapping)
 * - Sends JSON control messages: flush, reset
 * - Receives JSON messages: word, vad, done
 * - Auto-reconnects with exponential backoff (1s -> 2s -> 4s -> max 30s)
 */
export class SttStreamClient {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: SttStreamCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private closed = false;

  constructor(url: string, callbacks: SttStreamCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.closed) return;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.on('open', () => {
        this.reconnectDelay = 1000; // reset backoff on successful connect
        this.callbacks.onConnected?.();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString());
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
        this.callbacks.onDisconnected?.();
        if (!this.closed) {
          this.scheduleReconnect();
        }
      });
    } catch (err) {
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error(String(err))
      );
      if (!this.closed) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Send raw PCM Float32 audio as a binary WebSocket frame.
   * Silently drops frames if the connection is not open.
   */
  sendAudio(pcm: Float32Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }

  /**
   * Tell the STT service to finalize the current utterance.
   */
  flush(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'flush' }));
  }

  /**
   * Tell the STT service to discard state and start fresh.
   */
  reset(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'reset' }));
  }

  /**
   * Permanently close the connection. No reconnect will be attempted.
   */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff: double the delay, capped at maxReconnectDelay
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }
}
