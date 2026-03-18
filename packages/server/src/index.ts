import type { Server as HttpServer } from 'http';
import type { Express } from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { createVoiceWebSocketHandler } from './createVoiceWebSocketHandler.js';
import { createPersonaRoutes } from './createPersonaRoutes.js';
import { createFeedbackRoutes } from './feedbackRoutes.js';
import { PersonaStore } from './personaStore.js';

// Read kit version from the server package.json at module load
let KIT_VERSION: string | undefined;
try {
  const pkgPath = new URL('../package.json', import.meta.url);
  KIT_VERSION = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
} catch { /* version will be omitted from feedback */ }

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

  const dataDir = options.personaDir ? path.dirname(options.personaDir) : path.join(process.cwd(), 'data');

  const { broadcast } = createVoiceWebSocketHandler(server, {
    ...options,
    dataDir,
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
    const { router: feedbackRouter } = createFeedbackRoutes(dataDir, KIT_VERSION);
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
