import type { Server as HttpServer } from 'http';
import type { Express } from 'express';
import path from 'path';
import { createVoiceWebSocketHandler } from './createVoiceWebSocketHandler.js';
import { createPersonaRoutes } from './createPersonaRoutes.js';
import { createFeedbackRoutes } from './feedbackRoutes.js';
import { PersonaStore } from './personaStore.js';

export type { VoiceServerOptions } from './types.js';
import type { VoiceServerOptions } from './types.js';

/**
 * Attaches the voice pipeline WebSocket handler to the HTTP server.
 * Optionally mounts persona routes on the Express app.
 */
export function attachVoicePipeline(
  server: HttpServer,
  options: VoiceServerOptions,
  app?: Express,
): void {
  // Create persona store first so WebSocket handler can read activeVoiceId
  let personaStore: PersonaStore | undefined;
  if (options.personaDir) {
    personaStore = new PersonaStore(options.personaDir, options.config);
  }

  const { broadcast } = createVoiceWebSocketHandler(server, {
    ...options,
    getActiveVoiceId: personaStore ? () => personaStore!.getActiveVoiceId() : undefined,
  });

  if (personaStore && app) {
    const { router } = createPersonaRoutes({
      personaDir: options.personaDir!,
      ttsUpstreamUrl: ({
        'luxtts': options.luxTtsUrl ?? process.env.LUXTTS_URL,
        'qwen3-tts': options.qwen3TtsUrl ?? process.env.QWEN3_TTS_URL,
        'chatterbox-turbo': options.chatterboxTurboUrl ?? process.env.CHATTERBOX_TURBO_URL,
        'cosyvoice': options.cosyVoiceTtsUrl ?? process.env.COSYVOICE_TTS_URL,
      } as Record<string, string | undefined>)[options.ttsProvider ?? process.env.TTS_PROVIDER ?? ''],
      store: personaStore,
      adminPassword: options.adminPassword,
      broadcast,
    });
    app.use('/api/agent', router);
  }

  if (app) {
    const dataDir = options.personaDir ? path.dirname(options.personaDir) : path.join(process.cwd(), 'data');
    const { router: feedbackRouter } = createFeedbackRoutes(dataDir);
    app.use('/api/feedback', feedbackRouter);
  }
}

export { createPersonaRoutes } from './createPersonaRoutes.js';
export { createFeedbackRoutes } from './feedbackRoutes.js';
export type { FeedbackEntry } from './feedbackRoutes.js';
export { buildSystemPrompt } from './systemPrompt.js';
export { createBuiltinTools } from './builtinTools.js';
export { buildSynonymMap, fuzzySearch } from './builtinTools.js';
export type { ClientState } from './systemPrompt.js';
export type { PersonaRoutesOptions } from './createPersonaRoutes.js';
export { createSessionLogger } from './logger.js';
export type { SessionLogger } from './logger.js';
