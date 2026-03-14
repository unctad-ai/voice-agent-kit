import type { SiteConfig } from '@unctad-ai/voice-agent-core';

export interface VoiceServerOptions {
  config: SiteConfig;
  groqApiKey: string;
  groqModel?: string;
  sttProvider?: string;
  kyutaiSttUrl?: string;
  ttsProvider?: string;
  qwen3TtsUrl?: string;
  chatterboxTurboUrl?: string;
  cosyVoiceTtsUrl?: string;
  pocketTtsUrl?: string;
  resembleApiKey?: string;
  resembleModel?: string;
  resembleVoiceUuid?: string;
  personaDir?: string;
  /** When true, fall back to alternate TTS providers if primary fails. Default: false */
  ttsFallback?: boolean;
}
