import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SttStreamClient } from '../sttStreamClient.js';
import { WsState } from '../wsState.js';

// Mock the ws module with a proper class
vi.mock('ws', () => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = 1;
    binaryType = 'arraybuffer';
    private _listeners = new Map<string, Function[]>();

    on(event: string, handler: Function) {
      const existing = this._listeners.get(event) || [];
      existing.push(handler);
      this._listeners.set(event, existing);
    }

    send() {}
    close() {}
    removeAllListeners() {
      this._listeners.clear();
    }

    // Test helper: trigger an event
    _emit(event: string, ...args: unknown[]) {
      for (const handler of this._listeners.get(event) || []) {
        handler(...args);
      }
    }
  }

  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

describe('SttStreamClient state machine', () => {
  let client: SttStreamClient;
  let callbacks: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    callbacks = {
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
    };
    client = new SttStreamClient('ws://localhost:8003/ws/transcribe', callbacks);
  });

  afterEach(() => {
    client.close();
  });

  it('starts in CLOSED state', () => {
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('transitions to CONNECTING on connect()', () => {
    client.connect();
    expect(client.state).toBe(WsState.CONNECTING);
  });

  it('sendAudio is a no-op when not OPEN', () => {
    const pcm = new Float32Array(1920);
    // Should not throw in CLOSED state
    client.sendAudio(pcm);
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('flush is a no-op when not OPEN', () => {
    client.flush();
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('reset is a no-op when not OPEN', () => {
    client.reset();
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('close() transitions to CLOSED and clears reconnect', () => {
    client.connect();
    expect(client.state).toBe(WsState.CONNECTING);
    client.close();
    expect(client.state).toBe(WsState.CLOSED);
  });

  it('isConnected returns false when not OPEN', () => {
    expect(client.isConnected).toBe(false);
    client.connect();
    expect(client.isConnected).toBe(false); // CONNECTING, not OPEN
  });
});
