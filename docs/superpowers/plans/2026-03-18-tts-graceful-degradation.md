# TTS Graceful Degradation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When TTS has no URL configured, degrade gracefully to text-only mode instead of crashing — signal this to the client via health check and session events so the UI shows the muted avatar.

**Architecture:** Server detects TTS availability at WebSocket handler creation by checking the selected provider's URL. This flag flows to the client via `session.created` event and is exposed through the health check. The voice pipeline skips TTS when unavailable. The client treats `ttsAvailable: false` the same as the user disabling speech in settings.

**Tech Stack:** TypeScript, WebSocket protocol, existing voice pipeline

---

### Task 1: Add `ttsAvailable` flag to server

**Files:**
- Modify: `packages/server/src/createVoiceWebSocketHandler.ts:76-109`
- Modify: `packages/server/src/protocol.ts:50-53`

- [ ] **Step 1: Add `ttsAvailable` to `SessionCreatedEvent`**

In `packages/server/src/protocol.ts`, update the interface:

```ts
export interface SessionCreatedEvent {
  type: 'session.created';
  session_id: string;
  tts_available: boolean;
}
```

- [ ] **Step 2: Compute and send `ttsAvailable` in handler**

In `packages/server/src/createVoiceWebSocketHandler.ts`, after building `ttsConfig` (line 93), add the check and pass it to the `session.created` event:

```ts
// After line 93 (end of ttsConfig)
const providerUrlMap: Record<string, string> = {
  'vllm-omni': ttsConfig.vllmOmniUrl,
  'qwen3-tts': ttsConfig.qwen3TtsUrl,
  'chatterbox-turbo': ttsConfig.chatterboxTurboUrl,
  'cosyvoice': ttsConfig.cosyVoiceTtsUrl,
  'luxtts': ttsConfig.luxTtsUrl,
  'pocket-tts': ttsConfig.pocketTtsUrl,
  'resemble': ttsConfig.resembleApiKey, // resemble uses API key, not URL
};
const ttsAvailable = Boolean(providerUrlMap[ttsConfig.ttsProvider]);
if (!ttsAvailable) {
  logger.warn('tts:unavailable', `provider=${ttsConfig.ttsProvider} — no URL configured, text-only mode`);
}
```

Update the `session.created` event (line 109):

```ts
safeSend(createEvent('session.created', { session_id: sessionId, tts_available: ttsAvailable }));
```

Pass `ttsAvailable` to the pipeline:

```ts
pipeline = new VoicePipeline({
  logger,
  sttClient,
  ttsConfig,
  ttsAvailable,  // <-- add
  groqApiKey: options.groqApiKey,
  // ... rest unchanged
});
```

- [ ] **Step 3: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/createVoiceWebSocketHandler.ts packages/server/src/protocol.ts
git commit -m "feat(server): detect TTS availability at startup and signal in session.created"
```

---

### Task 2: Skip TTS in voice pipeline when unavailable

**Files:**
- Modify: `packages/server/src/voicePipeline.ts:21-30` (VoicePipelineOptions type)
- Modify: `packages/server/src/voicePipeline.ts:294-315` (voice turn TTS section)
- Modify: `packages/server/src/voicePipeline.ts:388-402` (text turn TTS section)

- [ ] **Step 1: Add `ttsAvailable` to pipeline options and store it**

In `VoicePipelineOptions` interface:

```ts
export interface VoicePipelineOptions {
  logger: SessionLogger;
  sttClient: SttStreamClient;
  ttsConfig: TtsProviderConfig;
  ttsAvailable?: boolean;  // <-- add
  groqApiKey: string;
  // ... rest unchanged
}
```

In the constructor, store it:

```ts
this.ttsAvailable = options.ttsAvailable ?? true;
```

Add as class field:

```ts
private ttsAvailable: boolean;
```

- [ ] **Step 2: Skip TTS in voice turn when unavailable**

In the voice turn handler (around line 294), add a check right before the TTS block, after the empty-text check:

```ts
if (!this.ttsAvailable) {
  send(createEvent('response.audio.done', {}));
  send(createEvent('timings', { stt_ms: sttMs, llm_ms: llmMs, tts_ms: 0, total_ms: Date.now() - turnStart }));
  send(createEvent('status', { status: 'listening' }));
  this.logger.info('turn:done', 'no-tts', Date.now() - turnStart);
  return;
}
```

Insert this after the `if (!ttsText || ttsText.trim() === '')` block (line 303) and before `const ttsStart = Date.now();` (line 305).

- [ ] **Step 3: Skip TTS in text turn when unavailable**

In the text turn handler (around line 382-402), the TTS call is at line 392. Wrap the speaking section:

Replace the block starting at line 382:

```ts
if (assistantText.trim() && !assistantText.includes('<silent')) {
  this.session.conversation.push({ role: 'assistant', content: assistantText });
  send(createEvent('response.text.done', { text: assistantText }));
  send(createEvent('conversation.item.created', {
    item: { id: `msg_${Date.now()}`, role: 'assistant', content: assistantText },
  }));

  if (this.ttsAvailable) {
    send(createEvent('status', { status: 'speaking' }));
    const ttsText = sanitizeForTTS(assistantText);
    const ttsStart = Date.now();
    await this.streamTtsAudio(ttsText || assistantText, ttsConfig, signal, sendBinary);
    const ttsMs = Date.now() - ttsStart;
    this.logger.info('tts:done', `provider=${ttsConfig.ttsProvider} chars=${(ttsText || assistantText).length}`, ttsMs);
    send(createEvent('response.audio.done', {}));
    send(createEvent('timings', { stt_ms: 0, llm_ms: llmMs, tts_ms: ttsMs, total_ms: Date.now() - turnStart }));
  } else {
    send(createEvent('response.audio.done', {}));
    send(createEvent('timings', { stt_ms: 0, llm_ms: llmMs, tts_ms: 0, total_ms: Date.now() - turnStart }));
  }
```

- [ ] **Step 4: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/voicePipeline.ts
git commit -m "feat(server): skip TTS synthesis when provider URL not configured"
```

---

### Task 3: Expose `ttsAvailable` in health check

**Files:**
- Modify: `packages/core/src/services/voiceWebSocket.ts:226-279`

**Context:** The health check currently does a WebSocket handshake to verify the server is reachable. To get `ttsAvailable`, it needs to read the `session.created` event before closing the connection.

- [ ] **Step 1: Read `session.created` in health check**

Update `checkPipelineHealth` to listen for the `session.created` message:

```ts
export async function checkPipelineHealth(
  url: string,
): Promise<{ connected: boolean; ttsAvailable?: boolean }> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        resolve({ connected: false });
      }, 5000);

      ws.onopen = () => {
        // Wait briefly for session.created event
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === 'session.created') {
            clearTimeout(timer);
            ws.close();
            resolve({ connected: true, ttsAvailable: data.tts_available ?? true });
          }
        } catch {}
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve({ connected: false });
      };
    } catch {
      resolve({ connected: false });
    }
  });
}
```

- [ ] **Step 2: Pass through in `checkBackendHealth`**

```ts
export async function checkBackendHealth(): Promise<{ available: boolean; ttsAvailable?: boolean; message?: string }> {
  const url = buildDefaultWsUrl();
  const result = await checkPipelineHealth(url);
  if (result.connected) return { available: true, ttsAvailable: result.ttsAvailable };
  return { available: false, message: 'Voice pipeline unreachable' };
}
```

- [ ] **Step 3: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/voiceWebSocket.ts
git commit -m "feat(core): expose ttsAvailable in health check response"
```

---

### Task 4: Client reads `ttsAvailable` and forces muted state

**Files:**
- Modify: `packages/core/src/hooks/useVoiceWebSocket.ts:110-113`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:910-928`

- [ ] **Step 1: Read `ttsAvailable` from `session.created` in useVoiceWebSocket**

Add state and read from the event:

```ts
const [ttsAvailable, setTtsAvailable] = useState(true);
```

Update the `session.created` handler (line 110):

```ts
manager.onEvent('session.created', (event: { tts_available?: boolean }) => {
  setIsConnected(true);
  setLastErrorCode(null);
  setTtsAvailable(event.tts_available ?? true);
});
```

Add `ttsAvailable` to the hook's return value.

- [ ] **Step 2: Expose effective TTS state in useVoiceAgent**

In `useVoiceAgent.ts`, the `settings` object already has `ttsEnabled`. Compute effective TTS and expose it:

At the return block (~line 910), add to the returned `settings`:

```ts
return {
  // ... existing fields
  settings: {
    ...settings,
    ttsEnabled: settings.ttsEnabled && voiceWs.ttsAvailable,
  },
};
```

This way `settings.ttsEnabled` becomes `false` when the server reports TTS unavailable — the UI already reads this to show the muted avatar.

- [ ] **Step 3: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useVoiceWebSocket.ts packages/core/src/hooks/useVoiceAgent.ts
git commit -m "feat(core): client reads ttsAvailable and forces muted avatar when TTS unavailable"
```

---

### Task 5: Final verification

- [ ] **Step 1: Build and typecheck all packages**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 2: Manual testing**

1. Start server with `LUXTTS_URL=` (empty) → logs should show `tts:unavailable`
2. Health check should return `ttsAvailable: false`
3. Open panel → avatar should show muted icon
4. Voice turn should complete with text-only response, no crash
5. Text submit should work, no audio
6. Set `LUXTTS_URL=http://...` and restart → everything works normally, avatar not muted

- [ ] **Step 3: Commit any fixes**
