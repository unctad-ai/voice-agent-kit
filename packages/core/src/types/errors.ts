export type VoiceErrorType =
  | 'mic_denied'
  | 'mic_unavailable'
  | 'mic_busy'
  | 'vad_load_failed'
  | 'stt_failed'
  | 'tts_failed'
  | 'network_error'
  | 'llm_failed'
  | 'speech_too_short'
  | 'not_addressed'
  | 'processing'
  | null;
