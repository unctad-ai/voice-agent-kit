import type { SiteConfig } from '@unctad-ai/voice-agent-core';

export interface VoiceServerOptions {
  config: SiteConfig;
  groqApiKey: string;
  groqModel?: string;
  sttProvider?: string;
  sttUrl?: string;
  ttsProvider?: string;
  vllmOmniUrl?: string;
  vllmOmniRefAudio?: string;
  vllmOmniRefText?: string;
  qwen3TtsUrl?: string;
  chatterboxTurboUrl?: string;
  cosyVoiceTtsUrl?: string;
  luxTtsUrl?: string;
  luxTtsSpeed?: number;
  luxTtsTShift?: number;
  pocketTtsUrl?: string;
  resembleApiKey?: string;
  resembleModel?: string;
  resembleVoiceUuid?: string;
  personaDir?: string;
  /** Callback to get the active voice ID from persona store. Set automatically by attachVoicePipeline. */
  getActiveVoiceId?: () => string;
  /** When true, fall back to alternate TTS providers if primary fails. Default: false */
  ttsFallback?: boolean;
  /** When false, skip the STT hallucination filter (vadProbs-based). Default: true for kyutai, false for nemotron/other providers. */
  sttHallucinationFilter?: boolean;
  /** Password for shared settings admin UI. Default: 'admin'. */
  adminPassword?: string;
}
