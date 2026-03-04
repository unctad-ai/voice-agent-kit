import { streamText, convertToModelMessages, stepCountIs } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import type { SiteConfig } from '@voice-agent/core';
import type { Request, Response } from 'express';
import type { ServerResponse } from 'node:http';
import { buildSystemPrompt } from './systemPrompt.js';
import { createBuiltinTools } from './builtinTools.js';
import type { ClientState } from './systemPrompt.js';

export interface ChatHandlerOptions {
  config: SiteConfig;
  groqApiKey: string;
  groqModel?: string;
}

export function createChatHandler(options: ChatHandlerOptions): (req: Request, res: Response) => Promise<void> {
  const { config, groqApiKey, groqModel } = options;
  const groq = createGroq({ apiKey: groqApiKey });
  const { serverTools, clientTools } = createBuiltinTools(config);

  // Merge extra server tools from config if provided
  const allServerTools = config.extraServerTools
    ? { ...serverTools, ...(config.extraServerTools as Record<string, ReturnType<typeof import('ai').tool>>) }
    : serverTools;

  return async function chatHandler(req: Request, res: Response): Promise<void> {
    try {
      const { messages, clientState } = req.body as { messages?: unknown[]; clientState?: ClientState };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages array is required' });
        return;
      }

      // useChat sends UIMessage format; convert to model messages for streamText
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelMessages = await convertToModelMessages(messages as any);

      const result = streamText({
        model: groq(groqModel || 'openai/gpt-oss-120b'),
        system: buildSystemPrompt(config, clientState),
        messages: modelMessages,
        tools: { ...allServerTools, ...clientTools },
        stopWhen: stepCountIs(5),
        temperature: 0,
      });

      result.pipeUIMessageStreamToResponse(res as unknown as ServerResponse);

      // Consume the full text promise to catch async stream errors that would
      // otherwise crash the Node process as unhandled rejections.
      Promise.resolve(result.text).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Stream error:', msg);
      });
    } catch (error) {
      console.error('Chat error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Chat request failed' });
      }
    }
  };
}
