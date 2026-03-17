import type { Server as HttpServer } from 'http';
import type { Express } from 'express';
import { createVoiceWebSocketHandler } from './createVoiceWebSocketHandler.js';
import { createPersonaRoutes } from './createPersonaRoutes.js';

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
  createVoiceWebSocketHandler(server, options);

  if (options.personaDir && app) {
    const { router } = createPersonaRoutes({
      personaDir: options.personaDir,
      ttsUpstreamUrl: ({
        'luxtts': options.luxTtsUrl,
        'qwen3-tts': options.qwen3TtsUrl,
        'chatterbox-turbo': options.chatterboxTurboUrl,
        'cosyvoice': options.cosyVoiceTtsUrl,
      } as Record<string, string | undefined>)[options.ttsProvider ?? ''],
    });
    app.use('/api/agent', router);
  }
}

export { createPersonaRoutes } from './createPersonaRoutes.js';
export { buildSystemPrompt } from './systemPrompt.js';
export { createBuiltinTools } from './builtinTools.js';
export { buildSynonymMap, fuzzySearch } from './builtinTools.js';
export type { ClientState } from './systemPrompt.js';
export type { PersonaRoutesOptions } from './createPersonaRoutes.js';
