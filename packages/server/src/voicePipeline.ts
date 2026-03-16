import { streamText, type ModelMessage } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import type { SiteConfig } from '@unctad-ai/voice-agent-core';
import type { SttStreamClient } from './sttStreamClient.js';
import type { TtsProviderConfig } from './ttsProviders.js';
import { synthesize } from './ttsProviders.js';
import { buildSystemPrompt, type ClientState } from './systemPrompt.js';
import { createBuiltinTools } from './builtinTools.js';
import { createEvent } from './protocol.js';
import { sanitizeForTTS } from './textUtils.js';
import { AsyncQueue } from './asyncQueue.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VoicePipelineOptions {
  sttClient: SttStreamClient;
  ttsConfig: TtsProviderConfig;
  groqApiKey: string;
  groqModel?: string;
  send: (event: string) => void;
  sendBinary: (data: Buffer) => void;
  siteConfig: SiteConfig;
}

interface SttDoneResult {
  text: string;
  vadProbs: number[];
  durationMs: number;
}

/** Lightweight conversation message shape for internal storage. */
interface ConversationMessage {
  role: string;
  content: unknown;
}

interface SessionState {
  conversation: ConversationMessage[];
  clientState?: ClientState;
  voice?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 25;
const CLIENT_TOOL_TIMEOUT_MS = 30_000;
const WAV_HEADER_SIZE = 44;
const NO_SPEECH_PROB_THRESHOLD = 0.6;
const AVG_LOGPROB_THRESHOLD = -0.7;

// ─── Pipeline ────────────────────────────────────────────────────────────────

export class VoicePipeline {
  private options: VoicePipelineOptions;
  private session: SessionState = { conversation: [] };
  private abortController: AbortController | null = null;

  // STT done queue (replaces fragile sttDoneResolve pattern)
  private sttQueue = new AsyncQueue<SttDoneResult>();

  // Client tool call promises
  private pendingToolCalls = new Map<string, (result: unknown) => void>();

  constructor(options: VoicePipelineOptions) {
    this.options = options;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Called on `session.update`. Stores conversation history, language, voice settings.
   */
  setSession(event: {
    conversation?: unknown[];
    clientState?: ClientState;
    voice?: string;
  }): void {
    if (event.conversation) {
      this.session.conversation = event.conversation.map((msg) => {
        const m = msg as Record<string, unknown>;
        return {
          role: (m.role as string) || 'user',
          content: (m.content as string) || '',
        };
      });
    }
    if (event.clientState !== undefined) {
      this.session.clientState = event.clientState;
    }
    if (event.voice !== undefined) {
      this.session.voice = event.voice;
    }
  }

  /**
   * Called on `tool.result`. Resolves pending promise for a client tool call.
   */
  resolveToolCall(toolCallId: string, result: unknown): void {
    const resolve = this.pendingToolCalls.get(toolCallId);
    if (resolve) {
      this.pendingToolCalls.delete(toolCallId);
      resolve(result);
    }
  }

  /**
   * Called when STT emits `done`. Enqueues the result for startTurn to consume.
   */
  resolveSttDone(text: string, vadProbs: number[], durationMs: number): void {
    this.sttQueue.put({ text, vadProbs, durationMs });
  }

  /**
   * Aborts current turn via AbortController.
   */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;

    // Reject all pending tool calls
    for (const [id, resolve] of this.pendingToolCalls) {
      resolve({ error: 'cancelled' });
      this.pendingToolCalls.delete(id);
    }

    // Cancel pending STT
    this.sttQueue.cancel();
  }

  /**
   * Main orchestration: STT -> LLM -> TTS per voice turn.
   */
  async startTurn(): Promise<void> {
    const { send, sendBinary, siteConfig, groqApiKey, groqModel, ttsConfig } = this.options;
    const turnStart = Date.now();

    // 1. Create new AbortController for this turn
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // 2. Send processing status
      send(createEvent('status', { status: 'processing' }));

      // 3. Wait for STT done
      const sttStart = Date.now();
      const sttResult = await this.waitForSttDone(signal);
      const sttMs = Date.now() - sttStart;

      // 4. Send STT result to client
      send(createEvent('stt.result', { transcript: sttResult.text }));

      // 5. Hallucination filter
      const { noSpeechProb, avgLogprob } = this.extractVadMetrics(sttResult.vadProbs || []);
      const text = sttResult.text.trim();

      if (
        !text ||
        noSpeechProb > NO_SPEECH_PROB_THRESHOLD ||
        avgLogprob < AVG_LOGPROB_THRESHOLD
      ) {
        console.log(
          `[voice-pipeline] Filtered: text="${text.slice(0, 50)}" noSpeech=${noSpeechProb.toFixed(3)} avgLog=${avgLogprob.toFixed(3)}`
        );
        send(createEvent('status', { status: 'listening' }));
        return;
      }

      // 6. Add user message to conversation
      this.session.conversation.push({ role: 'user', content: text });
      send(
        createEvent('conversation.item.created', {
          item: {
            id: `msg_${Date.now()}`,
            role: 'user',
            content: text,
          },
        })
      );

      // 7. Call LLM with tool loop
      const llmStart = Date.now();
      const assistantText = await this.runLlmLoop(
        siteConfig,
        groqApiKey,
        groqModel || 'openai/gpt-oss-120b',
        signal
      );
      const llmMs = Date.now() - llmStart;

      // 8. Send response.text.done
      send(createEvent('response.text.done', { text: assistantText }));

      // Add assistant message to conversation
      this.session.conversation.push({ role: 'assistant', content: assistantText });

      // 9. Sanitize text for TTS
      const ttsText = sanitizeForTTS(assistantText);

      if (!ttsText || ttsText === '[SILENT]' || ttsText.trim() === '') {
        send(createEvent('response.audio.done', {}));
        send(
          createEvent('timings', {
            stt_ms: sttMs,
            llm_ms: llmMs,
            tts_ms: 0,
            total_ms: Date.now() - turnStart,
          })
        );
        send(createEvent('status', { status: 'listening' }));
        return;
      }

      // 10. Call TTS and stream audio
      const ttsStart = Date.now();
      await this.streamTtsAudio(ttsText, ttsConfig, signal, sendBinary);
      const ttsMs = Date.now() - ttsStart;

      // 11. Send audio done and timings
      send(createEvent('response.audio.done', {}));
      send(
        createEvent('timings', {
          stt_ms: sttMs,
          llm_ms: llmMs,
          tts_ms: ttsMs,
          total_ms: Date.now() - turnStart,
        })
      );

      // 12. Back to listening
      send(createEvent('status', { status: 'listening' }));
    } catch (err) {
      if (signal.aborted) {
        console.log('[voice-pipeline] Turn cancelled');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : '';
      console.error('[voice-pipeline] Turn error:', message);
      if (stack) console.error('[voice-pipeline] Stack:', stack);
      send(createEvent('error', { code: 'pipeline_error', message }));
      send(createEvent('status', { status: 'listening' }));
    } finally {
      this.abortController = null;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private waitForSttDone(signal: AbortSignal): Promise<SttDoneResult> {
    return this.sttQueue.take(signal);
  }

  /**
   * Extract VAD metrics from STT result:
   * - noSpeechProb = vadProbs[2] (P(no voice in 2s window))
   * - avgLogprob = -(1 - mean(vadProbs))
   */
  private extractVadMetrics(vadProbs: number[]): {
    noSpeechProb: number;
    avgLogprob: number;
  } {
    const noSpeechProb = vadProbs[2] ?? 0;
    const meanVadProb =
      vadProbs.length > 0
        ? vadProbs.reduce((s, v) => s + v, 0) / vadProbs.length
        : 1;
    const avgLogprob = vadProbs.length > 0 ? -1.0 * (1 - meanVadProb) : 0;
    return { noSpeechProb, avgLogprob };
  }

  /**
   * Run the LLM with a tool-call loop. Server tools are executed inline,
   * client tools are forwarded to the browser and awaited.
   */
  private async runLlmLoop(
    siteConfig: SiteConfig,
    groqApiKey: string,
    model: string,
    signal: AbortSignal
  ): Promise<string> {
    const { send } = this.options;
    const groq = createGroq({ apiKey: groqApiKey });
    const { serverTools, clientTools } = createBuiltinTools(siteConfig);

    // Merge extra server tools from config if provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allServerTools: Record<string, any> = siteConfig.extraServerTools
      ? { ...serverTools, ...siteConfig.extraServerTools }
      : { ...serverTools };

    const allTools = { ...allServerTools, ...clientTools };
    const serverToolNames = new Set(Object.keys(allServerTools));

    // Working copy of messages for this turn's tool loop.
    // Use CoreMessage[] directly — conversation stores { role, content } objects
    // which are already CoreMessage-compatible. No UIMessage conversion needed.
    const limit = Math.max(4, Math.min(20, 40));
    const trimmed = this.session.conversation.length > limit
      ? this.session.conversation.slice(-limit)
      : this.session.conversation;
    // Cast to ModelMessage[] — our conversation stores { role, content } which
    // streamText accepts directly as user/assistant messages.
    const messages = trimmed as ModelMessage[];

    let fullText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) throw new Error('cancelled');

      const result = streamText({
        model: groq(model),
        system: buildSystemPrompt(siteConfig, this.session.clientState),
        messages,
        tools: allTools,
        temperature: 0,
        abortSignal: signal,
      });

      // Stream text deltas to client
      let roundText = '';
      for await (const delta of result.textStream) {
        roundText += delta;
        send(createEvent('response.text.delta', { delta }));
      }
      fullText += roundText;

      // Check for tool calls in the response
      let response;
      try {
        response = await result.response;
      } catch (err) {
        if (signal.aborted) throw new Error('cancelled');
        console.error('[voice-pipeline] LLM stream error:', err);
        throw err;
      }
      const lastMessage = response.messages[response.messages.length - 1];

      // Extract tool calls from the assistant message
      const toolCalls = this.extractToolCalls(lastMessage);

      if (toolCalls.length === 0) {
        // No tool calls — LLM is done
        break;
      }

      // Add assistant message to working messages
      messages.push(lastMessage as ModelMessage);

      // Process each tool call
      const toolResults: ModelMessage[] = [];

      for (const tc of toolCalls) {
        if (signal.aborted) throw new Error('cancelled');

        let toolResult: unknown;

        if (serverToolNames.has(tc.name)) {
          // Server tool — has execute, call it directly
          const toolDef = allServerTools[tc.name];
          if (toolDef && typeof toolDef.execute === 'function') {
            try {
              toolResult = await toolDef.execute(tc.args);
            } catch (err) {
              toolResult = { error: err instanceof Error ? err.message : String(err) };
            }
          } else {
            toolResult = { error: `Server tool ${tc.name} has no execute function` };
          }
        } else {
          // Client tool — send to browser and wait for result
          send(
            createEvent('tool.call', {
              tool_call_id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            })
          );

          toolResult = await this.waitForClientToolResult(tc.id, signal);
        }

        toolResults.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: tc.id,
              toolName: tc.name,
              result: toolResult,
            },
          ],
        } as unknown as ModelMessage);
      }

      // Add tool results and continue the loop
      messages.push(...toolResults);
    }

    return fullText;
  }

  /**
   * Extract tool calls from an assistant response message.
   */
  private extractToolCalls(
    message: unknown
  ): Array<{ id: string; name: string; args: unknown }> {
    if (!message || typeof message !== 'object') return [];
    const msg = message as Record<string, unknown>;

    // Vercel AI SDK v6: assistant messages have content array with tool-call parts
    const content = msg.content;
    if (!Array.isArray(content)) return [];

    const calls: Array<{ id: string; name: string; args: unknown }> = [];
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        'type' in part &&
        (part as Record<string, unknown>).type === 'tool-call'
      ) {
        const p = part as Record<string, unknown>;
        calls.push({
          id: (p.toolCallId as string) || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: p.toolName as string,
          args: p.args,
        });
      }
    }
    return calls;
  }

  /**
   * Wait for a client tool result with timeout.
   */
  private waitForClientToolResult(
    toolCallId: string,
    signal: AbortSignal
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      this.pendingToolCalls.set(toolCallId, resolve);

      signal.addEventListener(
        'abort',
        () => {
          if (this.pendingToolCalls.has(toolCallId)) {
            this.pendingToolCalls.delete(toolCallId);
            reject(new Error('cancelled'));
          }
        },
        { once: true }
      );

      setTimeout(() => {
        if (this.pendingToolCalls.has(toolCallId)) {
          this.pendingToolCalls.delete(toolCallId);
          resolve({ error: 'Client tool call timed out' });
        }
      }, CLIENT_TOOL_TIMEOUT_MS);
    });
  }

  /**
   * Stream TTS audio to the client as binary frames.
   * Strips the 44-byte WAV header from the first chunk.
   */
  private async streamTtsAudio(
    text: string,
    ttsConfig: TtsProviderConfig,
    signal: AbortSignal,
    sendBinary: (data: Buffer) => void
  ): Promise<void> {
    const response = await synthesize(text, ttsConfig, signal);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`TTS failed (${response.status}): ${body.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error('TTS response has no body');
    }

    const reader = response.body.getReader();
    let isFirstChunk = true;

    try {
      while (true) {
        if (signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        let chunk = Buffer.from(value);

        // Strip WAV header from the first chunk
        if (isFirstChunk) {
          isFirstChunk = false;
          if (chunk.length > WAV_HEADER_SIZE) {
            chunk = chunk.subarray(WAV_HEADER_SIZE);
          } else {
            // First chunk is smaller than or equal to WAV header — skip entirely
            continue;
          }
        }

        if (chunk.length > 0) {
          sendBinary(chunk);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
