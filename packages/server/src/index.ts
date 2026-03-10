import type { SiteConfig } from '@unctad-ai/voice-agent-core';
import type { Router } from 'express';
import { createChatHandler } from './createChatHandler.js';
import { createSttHandler } from './createSttHandler.js';
import { createTtsHandler } from './createTtsHandler.js';
import { createPersonaRoutes } from './createPersonaRoutes.js';

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
}

export function createVoiceRoutes(options: VoiceServerOptions): {
  chat: (req: import('express').Request, res: import('express').Response) => Promise<void>;
  stt: Router;
  tts: Router;
  persona?: Router;
} {
  let personaRouter: Router | undefined;
  let getActiveVoiceId: (() => string) | undefined;

  if (options.personaDir) {
    const { router, store } = createPersonaRoutes({
      personaDir: options.personaDir,
      ttsUpstreamUrl: options.qwen3TtsUrl,
    });
    personaRouter = router;
    getActiveVoiceId = () => store.getActiveVoiceId();
  }

  return {
    chat: createChatHandler(options),
    stt: createSttHandler(options),
    tts: createTtsHandler({ ...options, getActiveVoiceId }),
    persona: personaRouter,
  };
}

export { createChatHandler } from './createChatHandler.js';
export { createSttHandler } from './createSttHandler.js';
export { createTtsHandler } from './createTtsHandler.js';
export { createPersonaRoutes } from './createPersonaRoutes.js';
export { buildSystemPrompt } from './systemPrompt.js';
export { createBuiltinTools } from './builtinTools.js';
export { buildSynonymMap, fuzzySearch } from './builtinTools.js';
export type { ClientState } from './systemPrompt.js';
export type { ChatHandlerOptions } from './createChatHandler.js';
export type { SttHandlerOptions } from './createSttHandler.js';
export type { TtsHandlerOptions } from './createTtsHandler.js';
export type { PersonaRoutesOptions } from './createPersonaRoutes.js';
