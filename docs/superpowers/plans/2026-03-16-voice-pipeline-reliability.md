# Voice Pipeline Reliability Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate silent hangs and TTS drops on turn 2-3 by adding turn tracing, timeouts, graceful degradation, and state hygiene.

**Architecture:** All changes in `voicePipeline.ts` + one method in `asyncQueue.ts`. A `turnId` counter threads through all log lines. LLM gets a 15s timeout. TTS failures degrade to text-only. State is cleaned between turns to prevent corruption.

**Tech Stack:** TypeScript, Vercel AI SDK v6, Node.js AbortSignal

**Spec:** `docs/superpowers/specs/2026-03-16-voice-pipeline-reliability-design.md`

---

### Task 1: Add drain() to AsyncQueue

**Files:**
- Modify: `packages/server/src/asyncQueue.ts:49-56`

- [ ] **Step 1: Add drain method**

After the `cancel()` method (line 55), add:

```typescript
  /** Discard all buffered items without affecting waiters. */
  drain(): void {
    this.buffer = [];
  }
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/asyncQueue.ts
git commit -m "feat(server): add drain() to AsyncQueue for stale STT cleanup"
```

---

### Task 2: Add turnId counter and LLM_TIMEOUT_MS constant

**Files:**
- Modify: `packages/server/src/voicePipeline.ts:49-68`

- [ ] **Step 1: Add constant and counter**

After `AVG_LOGPROB_THRESHOLD` (line 55), add:

```typescript
const LLM_TIMEOUT_MS = 15_000;
const LLM_FALLBACK_TEXT = 'Sorry, I could not process that. Could you try again?';
```

After `private pendingToolCalls` (line 68), add:

```typescript
  private turnId = 0;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/voicePipeline.ts
git commit -m "feat(server): add turnId counter and LLM timeout constant"
```

---

### Task 3: State hygiene guards in startTurn

**Files:**
- Modify: `packages/server/src/voicePipeline.ts:143-258` (startTurn method)

- [ ] **Step 1: Add abort-overlap, drain STT, and pending-tools cleanup**

Replace lines 143-258 (the entire `startTurn` method) with:

```typescript
  async startTurn(): Promise<void> {
    const { send, sendBinary, siteConfig, groqApiKey, groqModel, ttsConfig } = this.options;

    // 4a. Abort overlap — cancel previous turn if still running
    if (this.abortController) {
      this.cancel();
    }

    // 4c. Drain stale STT results from previous turns
    this.sttQueue.drain();

    const turn = ++this.turnId;
    const turnStart = Date.now();
    const log = (stage: string, detail = '', ms?: number) =>
      console.log(`[turn:${turn}] ${stage} ${detail}${ms != null ? ` (${ms}ms)` : ''}`);

    // 1. Create new AbortController for this turn
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    log('turn:start');

    try {
      // 2. Send processing status
      send(createEvent('status', { status: 'processing' }));

      // 3. Wait for STT done
      const sttStart = Date.now();
      const sttResult = await this.waitForSttDone(signal);
      const sttMs = Date.now() - sttStart;

      // 4. Send STT result to client
      log('stt:done', `"${sttResult.text.slice(0, 80)}"`, sttMs);
      send(createEvent('stt.result', { transcript: sttResult.text }));

      // 5. Hallucination filter
      const { noSpeechProb, avgLogprob } = this.extractVadMetrics(sttResult.vadProbs || []);
      const text = sttResult.text.trim();

      if (
        !text ||
        noSpeechProb > NO_SPEECH_PROB_THRESHOLD ||
        avgLogprob < AVG_LOGPROB_THRESHOLD
      ) {
        log('stt:filtered', `"${text.slice(0, 50)}" noSpeech=${noSpeechProb.toFixed(3)} avgLog=${avgLogprob.toFixed(3)}`);
        send(createEvent('status', { status: 'listening' }));
        return;
      }

      // 6. Add user message to conversation
      this.session.conversation.push({ role: 'user', content: text });
      send(
        createEvent('conversation.item.created', {
          item: { id: `msg_${Date.now()}`, role: 'user', content: text },
        })
      );

      // 7. Call LLM with tool loop — with timeout
      const model = groqModel || 'qwen/qwen3-32b';
      log('llm:start', `model=${model}`);
      const llmStart = Date.now();

      let assistantText: string;
      try {
        const llmSignal = AbortSignal.any([signal, AbortSignal.timeout(LLM_TIMEOUT_MS)]);
        assistantText = await this.runLlmLoop(siteConfig, groqApiKey, model, llmSignal);
      } catch (err) {
        if (signal.aborted) throw err; // real cancellation — rethrow
        // LLM timeout or error — use fallback
        log('llm:timeout', `${err instanceof Error ? err.message : String(err)}`, Date.now() - llmStart);
        assistantText = LLM_FALLBACK_TEXT;
      }

      const llmMs = Date.now() - llmStart;
      log('llm:done', `"${assistantText.slice(0, 80)}"`, llmMs);

      // 8. Send response.text.done
      send(createEvent('response.text.done', { text: assistantText }));
      this.session.conversation.push({ role: 'assistant', content: assistantText });

      // 9. Sanitize text for TTS
      const ttsText = sanitizeForTTS(assistantText);

      if (!ttsText || ttsText === '[SILENT]' || ttsText.trim() === '') {
        send(createEvent('response.audio.done', {}));
        send(createEvent('timings', { stt_ms: sttMs, llm_ms: llmMs, tts_ms: 0, total_ms: Date.now() - turnStart }));
        send(createEvent('status', { status: 'listening' }));
        log('turn:done', 'silent', Date.now() - turnStart);
        return;
      }

      // 10. Call TTS and stream audio — with graceful degradation
      const ttsStart = Date.now();
      let ttsMs: number;
      try {
        await this.streamTtsAudio(ttsText, ttsConfig, signal, sendBinary);
        ttsMs = Date.now() - ttsStart;
        log('tts:done', '', ttsMs);
      } catch (err) {
        if (signal.aborted) throw err;
        ttsMs = Date.now() - ttsStart;
        log('tts:error', `${err instanceof Error ? err.message : String(err)}`, ttsMs);
        // Graceful degradation: text was already sent, skip audio
      }

      // 11. Send audio done and timings
      send(createEvent('response.audio.done', {}));
      send(createEvent('timings', { stt_ms: sttMs, llm_ms: llmMs, tts_ms: ttsMs, total_ms: Date.now() - turnStart }));
      send(createEvent('status', { status: 'listening' }));
      log('turn:done', '', Date.now() - turnStart);
    } catch (err) {
      if (signal.aborted) {
        log('turn:cancelled');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      log('turn:error', message);
      if (err instanceof Error && err.stack) console.error(err.stack);
      send(createEvent('error', { code: 'pipeline_error', message }));
      send(createEvent('status', { status: 'listening' }));
    } finally {
      this.abortController = null;
      // 4b. Clear any pending tool calls that outlived the turn
      for (const [id, resolve] of this.pendingToolCalls) {
        resolve({ error: 'turn_ended' });
      }
      this.pendingToolCalls.clear();
    }
  }
```

- [ ] **Step 2: Add tool call logging in runLlmLoop**

In `runLlmLoop`, the existing `console.log` calls for tool calls are already present. Update them to use turnId by adding a `turn` parameter:

No change needed — `runLlmLoop` already logs tool calls with `[voice-pipeline]` prefix. The `startTurn` tracing wraps it with turnId timing.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/voicePipeline.ts
git commit -m "fix(server): add turn tracing, LLM timeout, TTS degradation, state hygiene"
```

---

### Task 4: Integration test with Docker

- [ ] **Step 1: Build and deploy**

Run: `pnpm docker:kenya`
Expected: Container starts, logs show `[voice-agent-kit] v3.0.1`

- [ ] **Step 2: Test happy path**

Speak: "Take me to the home page"
Expected in logs:
```
[turn:1] turn:start
[turn:1] stt:done "Take me to the home page" (XXms)
[turn:1] llm:start model=qwen/qwen3-32b
[turn:1] llm:done "..." (XXms)
[turn:1] tts:done (XXms)
[turn:1] turn:done (XXms)
```

- [ ] **Step 3: Test multi-turn stability**

Complete 5 consecutive turns. Verify all complete with `turn:done` in logs.

- [ ] **Step 4: Test TTS failure**

Temporarily set TTS URL to an invalid endpoint. Speak a query.
Expected: text response appears in transcript, no audio, no hang. Logs show `[turn:N] tts:error`.

- [ ] **Step 5: Verify no silent hangs**

Repeat "What services are available?" 5 times in a row.
Expected: all 5 turns complete. No stuck "Processing" states.
