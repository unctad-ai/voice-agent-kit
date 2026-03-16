/**
 * Shared test setup — minimal browser API mocks for vitest.
 *
 * Provides just enough for tests that touch WebSocket, AudioContext,
 * ReadableStream, or fetch without a real browser environment.
 */
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  url: string;
  protocol = '';

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
  }

  /** Test helper — simulate an incoming message. */
  _receive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

// ---------------------------------------------------------------------------
// AudioContext
// ---------------------------------------------------------------------------
const noopFn = () => {};

export class MockAudioContext {
  state = 'running';
  sampleRate = 44100;
  destination = {} as AudioDestinationNode;

  createBufferSource = vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null as (() => void) | null,
  }));

  createBuffer = vi.fn(
    (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: vi.fn(() => new Float32Array(length)),
    }),
  );

  createGain = vi.fn(() => ({
    gain: { value: 1, setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));

  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  decodeAudioData = vi.fn(() => Promise.resolve(this.createBuffer(1, 1, 44100)));
}

// ---------------------------------------------------------------------------
// Install on globalThis
// ---------------------------------------------------------------------------
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = MockWebSocket;
}

if (typeof globalThis.AudioContext === 'undefined') {
  (globalThis as any).AudioContext = MockAudioContext;
}

if (typeof globalThis.ReadableStream === 'undefined') {
  (globalThis as any).ReadableStream = class {
    getReader() {
      return {
        read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
        releaseLock: vi.fn(),
      };
    }
  };
}

if (typeof globalThis.fetch === 'undefined') {
  (globalThis as any).fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  );
}
