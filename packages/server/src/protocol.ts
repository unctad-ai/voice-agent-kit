// ─── Client → Server Events ───────────────────────────────────────────────────

export interface SessionUpdateEvent {
  type: 'session.update';
  conversation: unknown[];
  system?: string;
  voice?: string;
  clientState?: {
    route?: string;
    currentService?: { id: string; title: string; category: string } | null;
    categories?: Array<{ category: string; count: number }>;
    uiActions?: Array<{ id: string; description: string }>;
    formStatus?: { fieldCount: number; groups: string[] } | null;
  };
}

export interface InputAudioCommitEvent {
  type: 'input_audio_buffer.commit';
}

export interface InputAudioClearEvent {
  type: 'input_audio_buffer.clear';
}

export interface ResponseCancelEvent {
  type: 'response.cancel';
}

export interface ToolResultEvent {
  type: 'tool.result';
  tool_call_id: string;
  result: unknown;
}

export interface TextSubmitEvent {
  type: 'text.submit';
  text: string;
}

export type ClientEvent =
  | SessionUpdateEvent
  | InputAudioCommitEvent
  | InputAudioClearEvent
  | ResponseCancelEvent
  | ToolResultEvent
  | TextSubmitEvent;

// ─── Server → Client Events ───────────────────────────────────────────────────

export interface SessionCreatedEvent {
  type: 'session.created';
  session_id: string;
  tts_available: boolean;
}

export interface SpeechStartedEvent {
  type: 'input_audio_buffer.speech_started';
}

export interface SpeechStoppedEvent {
  type: 'input_audio_buffer.speech_stopped';
}

export interface ConversationItemCreatedEvent {
  type: 'conversation.item.created';
  item: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
  };
}

export interface ResponseTextDeltaEvent {
  type: 'response.text.delta';
  delta: string;
}

export interface ResponseTextDoneEvent {
  type: 'response.text.done';
  text: string;
}

export interface ResponseAudioDoneEvent {
  type: 'response.audio.done';
}

export interface ToolCallEvent {
  type: 'tool.call';
  tool_call_id: string;
  name: string;
  arguments: string;
}

export interface SttResultEvent {
  type: 'stt.result';
  transcript: string;
}

export interface StatusEvent {
  type: 'status';
  status: string;
  message?: string;
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
}

export interface TimingsEvent {
  type: 'timings';
  stt_ms?: number;
  llm_ms?: number;
  tts_ms?: number;
  total_ms?: number;
}

export type ServerEvent =
  | SessionCreatedEvent
  | SpeechStartedEvent
  | SpeechStoppedEvent
  | ConversationItemCreatedEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseAudioDoneEvent
  | ToolCallEvent
  | SttResultEvent
  | StatusEvent
  | ErrorEvent
  | TimingsEvent;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serializes a ServerEvent to a JSON string.
 * The `type` field is merged with the payload at the top level.
 */
export function createEvent(type: ServerEvent['type'], payload: Record<string, unknown>): string {
  return JSON.stringify({ type, ...payload });
}

/**
 * Parses a raw JSON string to a ClientEvent.
 * Returns null if the string is not valid JSON or lacks a `type` field.
 */
export function parseEvent(raw: string): ClientEvent | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null || !('type' in obj)) {
      return null;
    }
    return obj as ClientEvent;
  } catch {
    return null;
  }
}

/**
 * Checks whether a binary Buffer is a valid PCM audio frame.
 * Valid frames are non-empty and have a byte length divisible by 4
 * (each Float32 sample is 4 bytes).
 */
export function isAudioFrame(data: Buffer): boolean {
  return data.length > 0 && data.length % 4 === 0;
}
