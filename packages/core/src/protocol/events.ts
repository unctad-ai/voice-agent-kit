/**
 * Client-side mirror of the server protocol types.
 * Browser-compatible — uses ArrayBuffer instead of Buffer.
 */

// ---- Client -> Server Events ------------------------------------------------

export interface SessionUpdateEvent {
  type: 'session.update';
  conversation: unknown[];
  system?: string;
  voice?: string;
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

export type ClientEvent =
  | SessionUpdateEvent
  | InputAudioCommitEvent
  | InputAudioClearEvent
  | ResponseCancelEvent
  | ToolResultEvent;

// ---- Server -> Client Events ------------------------------------------------

export interface SessionCreatedEvent {
  type: 'session.created';
  session_id: string;
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

export interface VoiceErrorEvent {
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
  | VoiceErrorEvent
  | TimingsEvent;

// ---- Helpers ----------------------------------------------------------------

/**
 * Serializes a ClientEvent to a JSON string for sending over WebSocket.
 */
export function createClientEvent(
  type: ClientEvent['type'],
  payload?: Record<string, unknown>,
): string {
  return JSON.stringify({ type, ...payload });
}

/**
 * Parses a raw JSON string to a ServerEvent.
 * Returns null if the string is not valid JSON or lacks a `type` field.
 */
export function parseServerEvent(raw: string): ServerEvent | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null || !('type' in obj)) {
      return null;
    }
    return obj as ServerEvent;
  } catch {
    return null;
  }
}

/**
 * Checks whether an ArrayBuffer is a valid PCM audio frame.
 * Valid frames are non-empty and have a byte length divisible by 4
 * (each Float32 sample is 4 bytes).
 */
export function isAudioFrame(data: ArrayBuffer): boolean {
  return data.byteLength > 0 && data.byteLength % 4 === 0;
}
