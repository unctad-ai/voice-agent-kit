# Conversation Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users report bad assistant responses via a "Report" pill on each message, with a feedback-mode composer that submits to a server API.

**Architecture:** Four layers: (1) server feedback routes (POST/GET `/api/feedback`), (2) session ID threaded from server→WS→client, (3) Report pill on transcript messages, (4) feedback-mode composer with amber styling. Feedback is stored as JSON files on disk.

**Tech Stack:** Express router, React, Framer Motion, Lucide icons, existing voice-agent-kit patterns

---

### Task 1: Server feedback routes

**Files:**
- Create: `packages/server/src/feedbackRoutes.ts`
- Modify: `packages/server/src/index.ts:14-45`

- [ ] **Step 1: Create feedbackRoutes.ts**

```ts
import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

export interface FeedbackEntry {
  sessionId: string;
  turnNumber?: number;
  text: string;
  assistantMessage?: string;
  userMessage?: string;
  toolCalls?: string[];
  timings?: Record<string, number>;
  route?: string;
  copilotName?: string;
  userAgent?: string;
  timestamp: number;
}

export function createFeedbackRoutes(dataDir: string) {
  const router = Router();
  const feedbackDir = path.join(dataDir, 'feedback');

  // Ensure directory exists
  fs.mkdir(feedbackDir, { recursive: true }).catch(() => {});

  router.post('/', async (req, res) => {
    try {
      const entry: FeedbackEntry = {
        ...req.body,
        timestamp: Date.now(),
        userAgent: req.headers['user-agent'] || '',
      };
      const filename = `${entry.timestamp}-${entry.sessionId || 'unknown'}-${entry.turnNumber ?? 0}.json`;
      await fs.writeFile(path.join(feedbackDir, filename), JSON.stringify(entry, null, 2));
      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const { sessionId, copilotName, from, to, limit = '50' } = req.query as Record<string, string>;
      const files = await fs.readdir(feedbackDir).catch(() => [] as string[]);
      let entries: FeedbackEntry[] = [];
      for (const file of files.filter(f => f.endsWith('.json')).sort().reverse()) {
        if (entries.length >= parseInt(limit)) break;
        const data = JSON.parse(await fs.readFile(path.join(feedbackDir, file), 'utf8'));
        if (sessionId && data.sessionId !== sessionId) continue;
        if (copilotName && data.copilotName !== copilotName) continue;
        if (from && data.timestamp < new Date(from).getTime()) continue;
        if (to && data.timestamp > new Date(to).getTime()) continue;
        entries.push(data);
      }
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read feedback' });
    }
  });

  return { router };
}
```

- [ ] **Step 2: Mount in index.ts**

In `packages/server/src/index.ts`, after the persona routes block (line 43), add:

```ts
import { createFeedbackRoutes } from './feedbackRoutes.js';
```

And inside `attachVoicePipeline`, after the persona routes mount:

```ts
if (app) {
  const dataDir = options.personaDir ? path.dirname(options.personaDir) : path.join(process.cwd(), 'data');
  const { router: feedbackRouter } = createFeedbackRoutes(dataDir);
  app.use('/api/feedback', feedbackRouter);
}
```

Add `import path from 'path';` at the top if not already imported.

- [ ] **Step 3: Export from package index**

In `packages/server/src/index.ts`, add:

```ts
export { createFeedbackRoutes } from './feedbackRoutes.js';
```

- [ ] **Step 4: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/feedbackRoutes.ts packages/server/src/index.ts
git commit -m "feat(server): feedback API routes (POST/GET /api/feedback)"
```

---

### Task 2: Expose session ID to client

**Files:**
- Modify: `packages/core/src/hooks/useVoiceWebSocket.ts:50-64,112-116`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:910-933`

**Context:** The server already sends `session_id` in the `session.created` event (line 109 of `createVoiceWebSocketHandler.ts`). The client reads `tts_available` but ignores `session_id`. Thread it through to consumers.

- [ ] **Step 1: Read session_id in useVoiceWebSocket**

Add state:

```ts
const [sessionId, setSessionId] = useState<string | null>(null);
```

Update the `session.created` handler:

```ts
manager.onEvent('session.created', (event: { session_id?: string; tts_available?: boolean }) => {
  setIsConnected(true);
  setLastErrorCode(null);
  setTtsAvailable(event.tts_available ?? true);
  setSessionId(event.session_id ?? null);
});
```

Add `sessionId` to `UseVoiceWebSocketReturn` interface and the return object.

Reset in `disconnect()`:

```ts
setSessionId(null);
```

- [ ] **Step 2: Expose sessionId from useVoiceAgent**

In the return object of `useVoiceAgent`:

```ts
return {
  // ... existing fields
  sessionId: voiceWs.sessionId,
};
```

- [ ] **Step 3: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useVoiceWebSocket.ts packages/core/src/hooks/useVoiceAgent.ts
git commit -m "feat(core): expose sessionId from session.created event"
```

---

### Task 3: Report pill on assistant messages

**Files:**
- Modify: `packages/ui/src/components/VoiceTranscript.tsx:79-90,404-467`

**Context:** Add a `▶ Report` pill after each assistant message bubble. Tapping it calls an `onReport` callback with the message index and text.

- [ ] **Step 1: Add onReport prop to VoiceTranscript**

Add to `VoiceTranscriptProps`:

```ts
interface VoiceTranscriptProps {
  // ... existing props
  onReport?: (turnNumber: number, assistantMessage: string, userMessage?: string) => void;
}
```

Destructure `onReport` in the component function signature.

- [ ] **Step 2: Add Report pill after assistant message bubbles**

In the panel variant message rendering (after line 466, the closing `</div>` of the message bubble), add:

```tsx
{isAI && !isLast && onReport && (
  <motion.button
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    whileHover={{ opacity: 1 }}
    onClick={() => {
      const userMsg = visible.slice(0, idx).reverse().find(m => m.role === 'user');
      // Turn number = count of assistant messages up to this point
      const turnNumber = visible.slice(0, idx + 1).filter(m => m.role === 'assistant').length;
      onReport(turnNumber, msg.text, userMsg?.text);
    }}
    style={{
      marginTop: 4,
      fontSize: 11,
      padding: '3px 10px',
      borderRadius: 12,
      border: '1px solid #d97706',
      background: 'rgba(245,158,11,0.08)',
      color: '#92400e',
      cursor: 'pointer',
      opacity: 0.5,
    }}
  >
    ▶ Report
  </motion.button>
)}
```

Note: `!isLast` ensures the pill doesn't show on the currently-streaming message.

- [ ] **Step 3: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/VoiceTranscript.tsx
git commit -m "feat(ui): Report pill on assistant messages in transcript"
```

---

### Task 4: Feedback mode in ComposerBar

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:353-598` (ComposerBar)
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:784-960` (WiredPanelInner — wire everything)

**Context:** Add a third mode `'feedback'` to ComposerBar. When active: amber flag icon (left), amber-bordered input (center), send + cancel buttons (right). Submit posts to `/api/feedback`.

- [ ] **Step 1: Add feedback mode to ComposerBar**

Update mode state type:

```ts
const [mode, setMode] = useState<'voice' | 'text' | 'feedback'>(disabled ? 'text' : 'voice');
```

Add props (no local state — `feedbackTarget` is owned by WiredPanelInner):

```ts
onFeedbackSubmit?: (text: string, target: { assistantMessage: string; userMessage?: string; turnNumber: number }) => void;
feedbackTarget?: { assistantMessage: string; userMessage?: string; turnNumber: number } | null;
onFeedbackCancel?: () => void;
```

- [ ] **Step 2: Add feedback mode JSX**

Add a third branch in the `AnimatePresence` (after text mode), rendered when `mode === 'feedback'`:

```tsx
) : mode === 'feedback' ? (
  <motion.div
    key="feedback-mode"
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    className="flex items-center gap-2"
    style={{ height: 56, padding: '10px 14px' }}
  >
    {/* Flag indicator */}
    <div
      className="shrink-0 rounded-full flex items-center justify-center"
      style={{ width: 44, height: 44, backgroundColor: '#d97706' }}
    >
      <Flag style={{ width: 18, height: 18, color: 'white' }} />
    </div>

    {/* Amber input */}
    <div
      className="flex-1 min-w-0 flex items-center"
      style={{
        height: 36, borderRadius: 18, padding: '0 14px',
        backgroundColor: 'rgba(217,119,6,0.05)',
        border: '2px solid #d97706',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleFeedbackSubmit();
          if (e.key === 'Escape') handleFeedbackCancel();
        }}
        placeholder="What went wrong?"
        className="w-full"
        style={{
          fontSize: '14px', color: '#1a1a1a', background: 'transparent',
          border: 'none', outline: 'none', padding: 0,
        }}
      />
    </div>

    {/* Send button (only when text entered) */}
    <AnimatePresence>
      {text.trim().length > 0 && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={SPRING_MICRO}
          whileTap={{ scale: 0.9 }}
          onClick={handleFeedbackSubmit}
          className="shrink-0 rounded-full flex items-center justify-center cursor-pointer"
          style={{ width: 44, height: 44, backgroundColor: '#d97706', color: 'white' }}
        >
          <ArrowUp style={{ width: 18, height: 18 }} />
        </motion.button>
      )}
    </AnimatePresence>

    {/* Cancel button */}
    <motion.button
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      onClick={handleFeedbackCancel}
      className="shrink-0 rounded-full flex items-center justify-center cursor-pointer"
      style={{ width: 44, height: 44, backgroundColor: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.35)' }}
    >
      <X style={{ width: 18, height: 18 }} />
    </motion.button>
  </motion.div>
) : null}
```

Add `Flag` to the Lucide imports at the top of the file.

- [ ] **Step 3: Add feedback submit/cancel handlers**

```ts
const handleFeedbackSubmit = () => {
  const trimmed = text.trim();
  if (!trimmed || !feedbackTarget) return;
  onFeedbackSubmit?.(trimmed, feedbackTarget);
  setText('');
  setMode('voice');
};

const handleFeedbackCancel = () => {
  setText('');
  setMode('voice');
  onFeedbackCancel?.();
};
```

Add effect to enter feedback mode when triggered externally:

```ts
useEffect(() => {
  if (feedbackTarget) {
    setMode('feedback');
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }
}, [feedbackTarget]);
```

- [ ] **Step 4: Wire in WiredPanelInner**

In `WiredPanelInner`, add feedback state and handler:

```ts
const [feedbackTarget, setFeedbackTarget] = useState<{ assistantMessage: string; userMessage?: string; turnNumber: number } | null>(null);
const [feedbackSentTurn, setFeedbackSentTurn] = useState<number | null>(null);

const handleReport = useCallback((turnNumber: number, assistantMessage: string, userMessage?: string) => {
  setFeedbackTarget({ assistantMessage, userMessage, turnNumber });
}, []);

const handleFeedbackCancel = useCallback(() => {
  setFeedbackTarget(null);
}, []);

const handleFeedbackSubmit = useCallback(async (text: string, target: { assistantMessage: string; userMessage?: string; turnNumber: number }) => {
  const backendUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';
  const url = backendUrl ? `${backendUrl}/api/feedback` : '/api/feedback';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        turnNumber: target.turnNumber,
        text,
        assistantMessage: target.assistantMessage,
        userMessage: target.userMessage,
        timings: lastTimings ?? undefined,
        route: window.location.pathname,
        copilotName: config.copilotName,
      }),
    });
    // Show "✓ Sent" on the Report pill for 2s
    setFeedbackSentTurn(target.turnNumber);
    setTimeout(() => setFeedbackSentTurn(null), 2000);
  } catch { /* silent — feedback is best-effort */ }
  setFeedbackTarget(null);
}, [sessionId, config.copilotName, lastTimings]);
```

Pass `onReport` and `feedbackSentTurn` to `VoiceTranscript`, and feedback props to `ComposerBar`:

```tsx
<VoiceTranscript ... onReport={handleReport} feedbackSentTurn={feedbackSentTurn} />
<ComposerBar ... feedbackTarget={feedbackTarget} onFeedbackSubmit={handleFeedbackSubmit} onFeedbackCancel={handleFeedbackCancel} />
```

Add `feedbackSentTurn?: number | null` to `VoiceTranscriptProps`. In the Report pill, show "✓ Sent" when `feedbackSentTurn` matches the turn:

```tsx
{isAI && !isLast && onReport && (() => {
  const turnNumber = visible.slice(0, idx + 1).filter(m => m.role === 'assistant').length;
  const isSent = feedbackSentTurn === turnNumber;
  return (
    <motion.button
      // ... same styling but:
      disabled={isSent}
      style={{ ...baseStyle, opacity: isSent ? 0.8 : 0.5, color: isSent ? '#16a34a' : '#92400e', borderColor: isSent ? '#16a34a' : '#d97706' }}
    >
      {isSent ? '✓ Sent' : '▶ Report'}
    </motion.button>
  );
})()}
```

Get `sessionId` from `useVoiceAgent` (added in Task 2):

```ts
const { state, start, stop, messages, ..., sessionId } = useVoiceAgent({ ... });
```

- [ ] **Step 5: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/GlassCopilotPanel.tsx packages/ui/src/components/VoiceTranscript.tsx
git commit -m "feat(ui): feedback mode composer with amber styling and Report pill"
```

---

### Task 5: Final verification

- [ ] **Step 1: Build and typecheck all packages**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 2: Manual testing**

1. Open panel, have a conversation
2. Report pill appears on assistant messages (not the streaming one)
3. Tap Report → composer switches to amber feedback mode
4. Type feedback, send → POST to `/api/feedback`
5. Cancel → returns to voice mode
6. `GET /api/feedback` returns submitted feedback
7. Verify feedback JSON file saved to `data/feedback/`

- [ ] **Step 3: Commit any fixes**
