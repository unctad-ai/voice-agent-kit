import { HEALTH_CHECK_TIMEOUT_MS, STT_TIMEOUT_MS, TTS_TIMEOUT_MS } from '../config/defaults';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
const API_KEY = import.meta.env.VITE_API_KEY || '';

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

export async function transcribeAudio(
  wavBlob: Blob,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<{ text: string; language: string; noSpeechProb: number; avgLogprob: number }> {
  const formData = new FormData();
  formData.append('audio', wavBlob, 'audio.wav');

  const timeout = AbortSignal.timeout(timeoutMs ?? STT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(`${BACKEND_URL}/api/stt`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
    signal: combined,
  });

  if (!res.ok) throw new Error(`STT failed: ${res.status}`);
  return res.json();
}

export async function checkLLMHealth(): Promise<{ available: boolean; message?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return { available: false, message: 'Server unreachable' };
    const data = await res.json();
    const llmStatus = data?.llm?.status;
    if (llmStatus === 'ok') return { available: true };
    const err = data?.llm?.error;
    const msg =
      typeof err === 'object' && err?.message ? err.message : 'AI service temporarily unavailable';
    return { available: false, message: msg };
  } catch {
    return { available: false, message: 'Server unreachable' };
  }
}

export interface TTSParams {
  temperature?: number;
  maxWords?: number;
}

export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal,
  params?: TTSParams,
  timeoutMs?: number
): Promise<ArrayBuffer> {
  // Combine caller abort signal with a timeout to prevent hanging
  const timeout = AbortSignal.timeout(timeoutMs ?? TTS_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // Truncate to server limit (2000 chars) — long responses still display as text
  const ttsText = text.length > 1900 ? text.slice(0, 1900).trimEnd() + '...' : text;

  const res = await fetch(`${BACKEND_URL}/api/tts`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text: ttsText, ...params }),
    signal: combined,
  });

  if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Stream TTS audio chunks as they arrive from the server.
 * Yields Uint8Array chunks from the response body, allowing the caller
 * to begin playback before the full response is received.
 */
export async function* streamSpeech(
  text: string,
  signal?: AbortSignal,
  params?: TTSParams,
  timeoutMs?: number
): AsyncGenerator<Uint8Array> {
  const timeout = AbortSignal.timeout(timeoutMs ?? TTS_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const ttsText = text.length > 1900 ? text.slice(0, 1900).trimEnd() + '...' : text;

  const res = await fetch(`${BACKEND_URL}/api/tts`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text: ttsText, ...params }),
    signal: combined,
  });

  if (!res.ok) throw new Error(`TTS streaming failed: ${res.status}`);
  if (!res.body) throw new Error('TTS response has no body (streaming unsupported)');

  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    await reader.cancel();
  }
}
