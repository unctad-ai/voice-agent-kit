import {
  streamText,
  type ModelMessage,
  type AssistantModelMessage,
  type ToolModelMessage,
} from 'ai';
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
import type { SessionLogger } from './logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VoicePipelineOptions {
  logger: SessionLogger;
  sttClient: SttStreamClient;
  ttsConfig: TtsProviderConfig;
  groqApiKey: string;
  groqModel?: string;
  send: (event: string) => void;
  sendBinary: (data: Buffer) => void;
  siteConfig: SiteConfig;
  sttHallucinationFilter?: boolean;
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
  ttsTemperature?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Summarize tool call input for logging — show what matters, skip the noise. */
function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const inp = input as Record<string, unknown>;
  switch (toolName) {
    case 'fillFormFields': {
      const fields = inp.fields;
      if (Array.isArray(fields)) {
        return fields.map((f: any) => `${f.fieldId}=${JSON.stringify(f.value)}`).join(', ');
      }
      return JSON.stringify(input);
    }
    case 'performUIAction':
      return String(inp.actionId ?? '');
    case 'navigateTo':
      return String(inp.page ?? '');
    case 'searchServices':
      return String(inp.query ?? '');
    case 'viewService':
    case 'getServiceDetails':
    case 'startApplication':
      return String(inp.serviceId ?? '');
    default:
      return '';
  }
}

/** Cap tool result logging to avoid flooding logs with large payloads. */
function summarizeToolResult(toolName: string, result: unknown): string {
  if (toolName === 'getFormSchema') return summarizeSchema(result);
  const json = JSON.stringify(result);
  if (json.length <= 500) return json;
  return json.slice(0, 500) + `… (${json.length} chars)`;
}

/** Summarize a getFormSchema result for logging: sections with field counts. */
function summarizeSchema(result: unknown): string {
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const sections = parsed?.sections;
    if (!Array.isArray(sections)) return `(${JSON.stringify(result).length} chars)`;
    const totalFields = sections.reduce((n: number, s: any) => n + (s.fields?.length ?? 0), 0);
    const summary = sections.map((s: any) => `${s.section}(${s.fields?.length ?? 0})`).join(', ');
    return `${sections.length} sections, ${totalFields} fields — ${summary}`;
  } catch {
    return `(${JSON.stringify(result).length} chars)`;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 25;
const CLIENT_TOOL_TIMEOUT_MS = 30_000;
const WAV_HEADER_SIZE = 44;
const NO_SPEECH_PROB_THRESHOLD = 0.6;
const AVG_LOGPROB_THRESHOLD = -0.7;
const LLM_TIMEOUT_MS = 15_000;
/** Delay before auto getFormSchema after fillFormFields (ms).
 *  Gives the client one React render cycle to register new progressive fields.
 *  Too short → stale schema (missing sections). Too long → slow response. */
const AUTO_SCHEMA_DELAY_MS = 500;
const LLM_FALLBACK_TEXT = 'Sorry, I could not process that. Could you try again?';

// ─── Pipeline ────────────────────────────────────────────────────────────────

export class VoicePipeline {
  private options: VoicePipelineOptions;
  private session: SessionState = { conversation: [] };
  private abortController: AbortController | null = null;
  private logger: SessionLogger;

  // STT done queue (replaces fragile sttDoneResolve pattern)
  private sttQueue = new AsyncQueue<SttDoneResult>();

  // Client tool call promises
  private pendingToolCalls = new Map<string, (result: unknown) => void>();
  private turnId = 0;

  constructor(options: VoicePipelineOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Called on `session.update`. Stores conversation history, language, voice settings.
   */
  setSession(event: {
    conversation?: unknown[];
    clientState?: ClientState;
    voice?: string;
    voice_settings?: { expressiveness?: number; [key: string]: unknown };
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
    if (event.voice_settings?.expressiveness !== undefined) {
      this.session.ttsTemperature = event.voice_settings.expressiveness;
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

    // 4a. Abort overlap — cancel previous turn if still running
    if (this.abortController) {
      this.cancel();
    }

    // 4c. Drain stale STT results from previous turns
    this.sttQueue.drain();

    this.logger.setTurn(++this.turnId);
    const turnStart = Date.now();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.logger.info('turn:start', `route=${this.session.clientState?.route ?? '?'}`);

    try {
      send(createEvent('status', { status: 'processing' }));

      // STT
      const sttStart = Date.now();
      const sttResult = await this.waitForSttDone(signal);
      const sttMs = Date.now() - sttStart;
      this.logger.info('stt:done', `"${sttResult.text}"`, sttMs);
      send(createEvent('stt.result', { transcript: sttResult.text }));

      const text = sttResult.text.trim();

      // Hallucination filter — skip for STT providers that don't produce
      // kyutai-compatible vadProbs (e.g. Nemotron, Parakeet)
      const useHallucinationFilter = this.options.sttHallucinationFilter ?? true;
      if (useHallucinationFilter) {
        const { noSpeechProb, avgLogprob } = this.extractVadMetrics(sttResult.vadProbs || []);
        if (
          !text ||
          noSpeechProb > NO_SPEECH_PROB_THRESHOLD ||
          avgLogprob < AVG_LOGPROB_THRESHOLD
        ) {
          this.logger.info('stt:filtered', `"${text.slice(0, 50)}" noSpeech=${noSpeechProb.toFixed(3)} avgLog=${avgLogprob.toFixed(3)}`);
          send(createEvent('status', { status: 'listening' }));
          return;
        }
      } else if (!text) {
        send(createEvent('status', { status: 'listening' }));
        return;
      }

      // User message
      this.session.conversation.push({ role: 'user', content: text });
      send(
        createEvent('conversation.item.created', {
          item: { id: `msg_${Date.now()}`, role: 'user', content: text },
        })
      );

      // LLM — with timeout
      const model = groqModel || 'qwen/qwen3-32b';
      this.logger.info('llm:start', `model=${model} msgs=${this.session.conversation.length}`);
      const llmStart = Date.now();

      let assistantText: string;
      try {
        assistantText = await this.runLlmLoop(siteConfig, groqApiKey, model, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        this.logger.info('llm:timeout', `${err instanceof Error ? err.message : String(err)}`, Date.now() - llmStart);
        assistantText = LLM_FALLBACK_TEXT;
      }

      const llmMs = Date.now() - llmStart;
      this.logger.info('llm:done', `"${assistantText}"`, llmMs);

      // Send text response
      send(createEvent('response.text.done', { text: assistantText }));
      this.session.conversation.push({ role: 'assistant', content: assistantText });

      // Silent check on raw text (before sanitization strips the tag)
      if (assistantText.includes('<silent')) {
        send(createEvent('response.audio.done', {}));
        send(createEvent('timings', { stt_ms: sttMs, llm_ms: llmMs, tts_ms: 0, total_ms: Date.now() - turnStart }));
        send(createEvent('status', { status: 'listening' }));
        this.logger.info('turn:done', 'silent', Date.now() - turnStart);
        return;
      }

      // TTS — with graceful degradation
      const ttsText = sanitizeForTTS(assistantText);

      if (!ttsText || ttsText.trim() === '') {
        send(createEvent('response.audio.done', {}));
        send(createEvent('timings', { stt_ms: sttMs, llm_ms: llmMs, tts_ms: 0, total_ms: Date.now() - turnStart }));
        send(createEvent('status', { status: 'listening' }));
        this.logger.info('turn:done', 'silent', Date.now() - turnStart);
        return;
      }

      const ttsStart = Date.now();
      let ttsMs: number;
      try {
        await this.streamTtsAudio(ttsText, ttsConfig, signal, sendBinary);
        ttsMs = Date.now() - ttsStart;
        this.logger.info('tts:done', `provider=${ttsConfig.ttsProvider} chars=${ttsText.length}`, ttsMs);
      } catch (err) {
        if (signal.aborted) throw err;
        ttsMs = Date.now() - ttsStart;
        this.logger.info('tts:error', `${err instanceof Error ? err.message : String(err)}`, ttsMs);
      }

      send(createEvent('response.audio.done', {}));
      send(createEvent('timings', { stt_ms: sttMs, llm_ms: llmMs, tts_ms: ttsMs, total_ms: Date.now() - turnStart }));
      send(createEvent('status', { status: 'listening' }));
      this.logger.info('turn:done', '', Date.now() - turnStart);
    } catch (err) {
      if (signal.aborted) {
        this.logger.info('turn:cancelled');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.info('turn:error', message);
      if (err instanceof Error && err.stack) this.logger.error('turn:stack', err.stack);
      send(createEvent('error', { code: 'pipeline_error', message }));
      send(createEvent('status', { status: 'listening' }));
    } finally {
      this.abortController = null;
      // 4b. Clear any pending tool calls that outlived the turn
      for (const [, resolve] of this.pendingToolCalls) {
        resolve({ error: 'turn_ended' });
      }
      this.pendingToolCalls.clear();
    }
  }

  /**
   * Text-only turn: skip STT, go straight to LLM → TTS.
   * Used for typed input and headless pipeline testing.
   */
  async startTextTurn(text: string): Promise<void> {
    const { send, sendBinary, siteConfig, groqApiKey, groqModel, ttsConfig } = this.options;

    if (this.abortController) this.cancel();
    this.sttQueue.drain();

    this.logger.setTurn(++this.turnId);
    const turnStart = Date.now();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.logger.info('text-turn:start', `"${text}"`);

    try {
      send(createEvent('status', { status: 'processing' }));
      send(createEvent('stt.result', { transcript: text }));

      this.session.conversation.push({ role: 'user', content: text });
      send(createEvent('conversation.item.created', {
        item: { id: `msg_${Date.now()}`, role: 'user', content: text },
      }));

      const model = groqModel || 'qwen/qwen3-32b';
      this.logger.info('llm:start', `model=${model} msgs=${this.session.conversation.length}`);
      const llmStart = Date.now();

      let assistantText: string;
      try {
        assistantText = await this.runLlmLoop(siteConfig, groqApiKey, model, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        throw err;
      }
      const llmMs = Date.now() - llmStart;
      this.logger.info('llm:done', `"${assistantText}"`, llmMs);

      if (assistantText.trim() && !assistantText.includes('<silent')) {
        this.session.conversation.push({ role: 'assistant', content: assistantText });
        send(createEvent('response.text.done', { text: assistantText }));
        send(createEvent('conversation.item.created', {
          item: { id: `msg_${Date.now()}`, role: 'assistant', content: assistantText },
        }));

        send(createEvent('status', { status: 'speaking' }));
        const ttsText = sanitizeForTTS(assistantText);
        const ttsStart = Date.now();
        await this.streamTtsAudio(ttsText || assistantText, ttsConfig, signal, sendBinary);
        const ttsMs = Date.now() - ttsStart;
        this.logger.info('tts:done', `provider=${ttsConfig.ttsProvider} chars=${(ttsText || assistantText).length}`, ttsMs);

        send(createEvent('response.audio.done', {}));
        send(createEvent('timings', { stt_ms: 0, llm_ms: llmMs, tts_ms: ttsMs, total_ms: Date.now() - turnStart }));
      } else {
        send(createEvent('response.text.done', { text: assistantText }));
        send(createEvent('response.audio.done', {}));
        send(createEvent('timings', { stt_ms: 0, llm_ms: llmMs, tts_ms: 0, total_ms: Date.now() - turnStart }));
      }
      send(createEvent('status', { status: 'listening' }));
    } catch (err) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.info('text-turn:error', message);
      send(createEvent('error', { code: 'pipeline_error', message }));
      send(createEvent('status', { status: 'listening' }));
    } finally {
      this.abortController = null;
      for (const [, resolve] of this.pendingToolCalls) resolve({ error: 'turn_ended' });
      this.pendingToolCalls.clear();
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

    // Strip execute from tools for streamText — we manage the tool loop manually
    // to support client tools via WebSocket. Without this, the SDK auto-executes
    // server tools and shifts response.messages (tool-result becomes last message),
    // causing extractToolCalls to find nothing and the loop to exit immediately.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolsForModel: Record<string, any> = {};
    for (const [name, t] of Object.entries(allTools)) {
      const { execute, ...def } = t as any;
      toolsForModel[name] = def;
    }

    // Working copy of messages for this turn's tool loop.
    // Keep tool call/result messages in history so the model remembers what it
    // did in prior turns (e.g. which fields it filled, which tools it called).
    // Without these, the model loses context and asks "what would you like to do?"
    // after every action instead of continuing proactively.
    const limit = 40; // Higher limit to accommodate tool messages (~3 msgs per tool call)
    const trimmed = this.session.conversation.length > limit
      ? this.session.conversation.slice(-limit)
      : this.session.conversation;
    // Accept user, assistant (text or tool-call content), and tool messages.
    // Only filter out malformed entries with no role.
    const cleaned = trimmed.filter(
      (m: any) => m.role && (m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    );
    const messages = cleaned as ModelMessage[];

    let fullText = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) throw new Error('cancelled');

      // Per-round timeout: covers only the streamText call, not client tool waits.
      // A multi-tool turn (search → view → details) can legitimately exceed 15s total,
      // but each individual LLM call should not.
      const roundSignal = AbortSignal.any([signal, AbortSignal.timeout(LLM_TIMEOUT_MS)]);

      const result = streamText({
        model: groq(model),
        system: buildSystemPrompt(siteConfig, this.session.clientState),
        messages,
        tools: toolsForModel,
        temperature: 0.1,
        topP: 0.8,
        abortSignal: roundSignal,
      });

      // Stream text deltas to client
      let roundText = '';
      try {
        for await (const delta of result.textStream) {
          roundText += delta;
          send(createEvent('response.text.delta', { delta }));
        }
        fullText += roundText;
      } catch (err: any) {
        if (signal.aborted) throw new Error('cancelled');
        // AI_NoOutputGeneratedError: model returned empty — treat as empty response
        if (err?.name === 'AI_NoOutputGeneratedError' || err?.message?.includes('No output generated')) {
          this.logger.info('llm:empty', 'no output generated');
          fullText += roundText;
          break;
        }
        this.logger.error('llm:stream-error', err);
        throw err;
      }

      // Use SDK's toolCalls promise — more reliable than manually parsing
      // response.messages, which shifts shape when tools have execute functions.
      const toolCalls = await result.toolCalls;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls — LLM is done
        break;
      }

      this.logger.info('tools', `round=${round + 1} ${toolCalls.map((tc) => `${tc.toolName}(${summarizeToolInput(tc.toolName, tc.input)})`).join(', ')}`);

      // Build the assistant message manually — response.messages may include
      // provider-specific parts (e.g. reasoning) that fail ModelMessage validation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assistantContent: any[] = [];
      if (roundText) {
        assistantContent.push({ type: 'text', text: roundText });
      }
      for (const tc of toolCalls) {
        assistantContent.push({
          type: 'tool-call',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        });
      }
      messages.push({
        role: 'assistant' as const,
        content: assistantContent,
      } satisfies AssistantModelMessage);

      // Process each tool call
      const toolResults: ModelMessage[] = [];

      for (const tc of toolCalls) {
        if (signal.aborted) throw new Error('cancelled');

        let toolResult: unknown;

        if (serverToolNames.has(tc.toolName)) {
          // Server tool — call execute from the original (un-stripped) tool definition
          const toolDef = allServerTools[tc.toolName];
          if (toolDef && typeof toolDef.execute === 'function') {
            try {
              toolResult = await toolDef.execute(tc.input);
              this.logger.info('server-tool', `${tc.toolName}: ${summarizeToolResult(tc.toolName, toolResult)}`);
            } catch (err) {
              toolResult = { error: err instanceof Error ? err.message : String(err) };
            }
          } else {
            toolResult = { error: `Server tool ${tc.toolName} has no execute function` };
          }
        } else {
          // Client tool — send to browser and wait for result
          send(
            createEvent('tool.call', {
              tool_call_id: tc.toolCallId,
              name: tc.toolName,
              arguments: JSON.stringify(tc.input ?? {}),
            })
          );

          toolResult = await this.waitForClientToolResult(tc.toolCallId, signal);
          this.logger.info('client-tool', `${tc.toolName}: ${summarizeToolResult(tc.toolName, toolResult)}`);
        }

        toolResults.push({
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              output: { type: 'json' as const, value: JSON.parse(JSON.stringify(toolResult)) },
            },
          ],
        } satisfies ToolModelMessage);
      }

      // Add tool results and continue the loop
      messages.push(...toolResults);

      // Auto-refresh form schema after fillFormFields or performUIAction on
      // dashboard pages. Progressive forms reveal new sections after fills, and
      // gated sections become available after performUIAction. The LLM must see
      // the updated state to guide the user correctly.
      const didFillForm = toolCalls.some((tc) => tc.toolName === 'fillFormFields');
      const didUIAction = toolCalls.some((tc) => tc.toolName === 'performUIAction');
      const isFormPage = this.session.clientState?.route?.startsWith('/dashboard');
      if ((didFillForm || didUIAction) && isFormPage && !signal.aborted) {
        // Wait for client React render cycle to register new progressive fields
        await new Promise((r) => setTimeout(r, AUTO_SCHEMA_DELAY_MS));
        if (signal.aborted) throw new Error('cancelled');

        const schemaCallId = `auto-schema-${Date.now()}`;
        send(
          createEvent('tool.call', {
            tool_call_id: schemaCallId,
            name: 'getFormSchema',
            arguments: '{}',
          })
        );
        const schemaResult = await this.waitForClientToolResult(schemaCallId, signal);
        this.logger.info('auto-schema', summarizeSchema(schemaResult));

        // Inject as if the LLM called getFormSchema itself
        messages.push({
          role: 'assistant' as const,
          content: [
            { type: 'tool-call', toolCallId: schemaCallId, toolName: 'getFormSchema', input: {} },
          ],
        } satisfies AssistantModelMessage);
        messages.push({
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: schemaCallId,
              toolName: 'getFormSchema',
              output: { type: 'json' as const, value: JSON.parse(JSON.stringify(schemaResult)) },
            },
          ],
        } satisfies ToolModelMessage);
      }
    }

    // Persist this turn's messages (including tool calls/results) back to
    // session.conversation so the next turn has full context of what happened.
    // The client sends text-only conversation via session.update, but the server
    // enriches it with tool call/result messages during each turn.
    this.session.conversation = messages;

    return fullText;
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
    const response = await synthesize(text, ttsConfig, signal, {
      temperature: this.session.ttsTemperature,
      logger: this.logger,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`TTS failed (${response.status}): ${body.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error('TTS response has no body');
    }

    const reader = response.body.getReader();
    let isFirstChunk = true;
    let carry = Buffer.alloc(0); // leftover byte from odd-sized chunks

    try {
      while (true) {
        if (signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        let chunk = Buffer.from(value);

        // Strip WAV header from the first chunk (not needed for raw PCM providers)
        if (isFirstChunk && !ttsConfig.rawPcm) {
          isFirstChunk = false;
          if (chunk.length > WAV_HEADER_SIZE) {
            chunk = chunk.subarray(WAV_HEADER_SIZE);
          } else {
            continue;
          }
        } else if (isFirstChunk) {
          isFirstChunk = false;
        }

        // Align to 2-byte boundary for Int16 PCM — HTTP chunked transfer
        // can deliver odd-sized chunks that crash new Int16Array() on the client.
        if (carry.length > 0) {
          chunk = Buffer.concat([carry, chunk]);
          carry = Buffer.alloc(0);
        }
        if (chunk.length % 2 !== 0) {
          carry = chunk.subarray(chunk.length - 1);
          chunk = chunk.subarray(0, chunk.length - 1);
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
