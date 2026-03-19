# Feedback v2 (Tickets + Lifecycle) & Triage Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ticket IDs and lifecycle statuses to the feedback system, show ticket IDs in the UI after submission, and update the marketplace triage skill to use lifecycle statuses.

**Architecture:** The `generateTicketId()` function hashes timestamp+sessionId+turnNumber into a 4-char alphanumeric ID (FB-XXXX). Feedback files are renamed from `{ts}-{sid}-{turn}.json` to `{ticketId}.json`. A new PATCH endpoint enables status transitions (new→triaged→confirmed→fixed, or new→triaged→dismissed). The UI shows the ticket ID with a copy button for 4 seconds after submission. Legacy v1 files are handled lazily on read.

**Tech Stack:** TypeScript, Express 5, React, Vitest, Lucide React icons

**Specs:**
- `docs/superpowers/specs/2026-03-19-feedback-v2-tickets-and-lifecycle.md`
- `docs/superpowers/specs/2026-03-19-feedback-triage-skill-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/server/src/feedbackRoutes.ts` | Add `generateTicketId()`, `ticketId` field, `status`/`rootCause`/`notes`/`updatedAt` fields, `GET /:ticketId`, `PATCH /:ticketId`, status filter on GET, `{ticketId}.json` filename, v1 migration |
| Create | `packages/server/src/__tests__/feedbackRoutes.test.ts` | Unit tests for all feedback functionality |
| Modify | `packages/ui/src/components/GlassCopilotPanel.tsx` | Handle `ticketId` from POST response, pass to VoiceTranscript |
| Modify | `packages/ui/src/components/VoiceTranscript.tsx` | Show ticket ID + copy button in confirmation state |
| Modify | `packages/server/src/index.ts` | Export new types |
| Modify | marketplace `plugins/voice-agent/skills/feedback-triage/SKILL.md` | Add PATCH step, default to `?status=new`, use ticket IDs in report |
| Modify | marketplace `plugins/voice-agent/commands/feedback-triage.md` | Add `--status` flag |

---

## Task 1: generateTicketId + FeedbackEntry Type

**Files:**
- Create: `packages/server/src/__tests__/feedbackRoutes.test.ts`
- Modify: `packages/server/src/feedbackRoutes.ts`

- [ ] **Step 1: Write tests for generateTicketId**

Create `packages/server/src/__tests__/feedbackRoutes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateTicketId } from '../feedbackRoutes.js';

describe('generateTicketId', () => {
  it('returns FB- prefix with 4 chars', () => {
    const id = generateTicketId(1710693600000, 'abc123', 2);
    expect(id).toMatch(/^FB-[A-Z2-9]{4}$/);
  });

  it('is deterministic', () => {
    const a = generateTicketId(1710693600000, 'abc123', 2);
    const b = generateTicketId(1710693600000, 'abc123', 2);
    expect(a).toBe(b);
  });

  it('produces different IDs for different inputs', () => {
    const a = generateTicketId(1710693600000, 'abc123', 2);
    const b = generateTicketId(1710693600000, 'abc123', 3);
    expect(a).not.toBe(b);
  });

  it('excludes ambiguous chars (0, O, 1, I)', () => {
    // Generate many IDs and check none contain ambiguous chars
    for (let i = 0; i < 100; i++) {
      const id = generateTicketId(Date.now() + i, `session${i}`, i);
      expect(id).not.toMatch(/[01OI]/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: FAIL — `generateTicketId` is not exported.

- [ ] **Step 3: Implement generateTicketId and update FeedbackEntry type**

In `packages/server/src/feedbackRoutes.ts`, add the function (exported) and update the interface:

```typescript
export function generateTicketId(timestamp: number, sessionId: string, turnNumber: number): string {
  const input = `${timestamp}-${sessionId}-${turnNumber}`;
  let hash = 0;
  for (const ch of input) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const abs = Math.abs(hash);
  return 'FB-' + Array.from({ length: 4 }, (_, i) =>
    chars[(abs >> (i * 5)) & 31]
  ).join('');
}
```

Update `FeedbackEntry` interface — add after existing fields:

```typescript
export interface FeedbackEntry {
  // ... existing fields ...
  ticketId: string;
  status: 'new' | 'triaged' | 'dismissed' | 'confirmed' | 'fixed';
  rootCause?: string;
  notes?: string;
  updatedAt?: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/feedbackRoutes.ts packages/server/src/__tests__/feedbackRoutes.test.ts
git commit -m "feat(server): add generateTicketId and feedback lifecycle types"
```

---

## Task 2: POST endpoint — generate ticketId, new filename, return ticketId

**Files:**
- Modify: `packages/server/src/feedbackRoutes.ts`
- Modify: `packages/server/src/__tests__/feedbackRoutes.test.ts`

- [ ] **Step 1: Write tests for POST with ticket ID**

Add to `feedbackRoutes.test.ts`. These tests need to exercise the Express router, so use a lightweight approach with `express` and `supertest`-style fetch. Since the project doesn't have `supertest`, test the route handler by importing `createFeedbackRoutes` and calling it with a temp directory:

```typescript
import { createFeedbackRoutes, generateTicketId } from '../feedbackRoutes.js';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { beforeEach, afterEach } from 'vitest';

describe('POST /api/feedback', () => {
  let app: express.Express;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-test-'));
    const { router } = createFeedbackRoutes(tmpDir);
    app = express();
    app.use(express.json());
    app.use('/api/feedback', router);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns ticketId in response', async () => {
    const res = await fetch(`http://...`); // see step 3 for actual approach
    // We'll use node's built-in fetch against a listening server
  });
});
```

Actually, to keep tests simple and avoid starting a server, test the logic more directly. Use a helper that calls the route handler. **Simpler approach** — test `generateTicketId` (already done) + test file I/O directly:

```typescript
describe('feedback file storage', () => {
  let tmpDir: string;
  let feedbackDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-'));
    feedbackDir = path.join(tmpDir, 'feedback');
    await fs.mkdir(feedbackDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saves file as {ticketId}.json', async () => {
    const { router } = createFeedbackRoutes(tmpDir);
    // Start a temporary server
    const server = express().use(express.json()).use('/api/feedback', router);
    const listener = server.listen(0);
    const port = (listener.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess1', turnNumber: 1, text: 'bad response' }),
      });
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.ticketId).toMatch(/^FB-[A-Z2-9]{4}$/);

      // Verify file is named {ticketId}.json
      const files = await fs.readdir(feedbackDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`${body.ticketId}.json`);

      // Verify ticketId and status are stored inside
      const stored = JSON.parse(await fs.readFile(path.join(feedbackDir, files[0]), 'utf8'));
      expect(stored.ticketId).toBe(body.ticketId);
      expect(stored.status).toBe('new');
    } finally {
      listener.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: FAIL — POST still returns `{ ok: true }` without ticketId, and file is named with old pattern.

- [ ] **Step 3: Update POST handler in feedbackRoutes.ts**

Replace the POST handler (lines 27-41) with:

```typescript
  router.post('/', async (req, res) => {
    try {
      const timestamp = Date.now();
      const sessionId = req.body.sessionId || 'unknown';
      const turnNumber = req.body.turnNumber ?? 0;
      const ticketId = generateTicketId(timestamp, sessionId, turnNumber);

      const entry: FeedbackEntry = {
        ...req.body,
        ...(kitVersion ? { kitVersion } : {}),
        timestamp,
        userAgent: req.headers['user-agent'] || '',
        ticketId,
        status: 'new',
      };
      const filename = `${ticketId}.json`;
      await fs.writeFile(path.join(feedbackDir, filename), JSON.stringify(entry, null, 2));
      res.status(201).json({ ok: true, ticketId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/feedbackRoutes.ts packages/server/src/__tests__/feedbackRoutes.test.ts
git commit -m "feat(server): POST /api/feedback returns ticketId, saves as {ticketId}.json"
```

---

## Task 3: GET endpoints — list with status filter, get by ticketId, v1 migration

**Files:**
- Modify: `packages/server/src/feedbackRoutes.ts`
- Modify: `packages/server/src/__tests__/feedbackRoutes.test.ts`

- [ ] **Step 1: Write tests for GET with status filter and v1 migration**

```typescript
describe('GET /api/feedback', () => {
  // reuse beforeEach/afterEach with tmpDir + express app

  it('filters by status', async () => {
    // Create two files: one 'new', one 'triaged'
    const feedbackDir = path.join(tmpDir, 'feedback');
    await fs.writeFile(path.join(feedbackDir, 'FB-AAAA.json'),
      JSON.stringify({ ticketId: 'FB-AAAA', status: 'new', text: 'a', timestamp: 1000 }));
    await fs.writeFile(path.join(feedbackDir, 'FB-BBBB.json'),
      JSON.stringify({ ticketId: 'FB-BBBB', status: 'triaged', text: 'b', timestamp: 2000 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/feedback?status=new`);
    const entries = await res.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].ticketId).toBe('FB-AAAA');
  });

  it('handles v1 files (missing ticketId/status)', async () => {
    const feedbackDir = path.join(tmpDir, 'feedback');
    // v1 filename pattern
    await fs.writeFile(path.join(feedbackDir, '1710693600000-sess1-2.json'),
      JSON.stringify({ sessionId: 'sess1', turnNumber: 2, text: 'old', timestamp: 1710693600000 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/feedback`);
    const entries = await res.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].ticketId).toMatch(/^FB-[A-Z2-9]{4}$/);
    expect(entries[0].status).toBe('new');
  });
});

describe('GET /api/feedback/:ticketId', () => {
  it('returns single entry by ticket ID', async () => {
    const feedbackDir = path.join(tmpDir, 'feedback');
    await fs.writeFile(path.join(feedbackDir, 'FB-XXYY.json'),
      JSON.stringify({ ticketId: 'FB-XXYY', status: 'new', text: 'test', timestamp: 1000 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/feedback/FB-XXYY`);
    expect(res.status).toBe(200);
    const entry = await res.json();
    expect(entry.ticketId).toBe('FB-XXYY');
  });

  it('returns 404 for unknown ticket', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/feedback/FB-ZZZZ`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: FAIL — no status filter, no `:ticketId` route, no v1 migration.

- [ ] **Step 3: Update GET handler and add GET /:ticketId**

In the GET `/` handler (lines 43-61), add v1 migration and status filter. After the existing filters:

```typescript
  router.get('/', async (req, res) => {
    try {
      const { sessionId, copilotName, from, to, limit = '50', status } = req.query as Record<string, string>;
      const files = await fs.readdir(feedbackDir).catch(() => [] as string[]);
      let entries: FeedbackEntry[] = [];
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const data = JSON.parse(await fs.readFile(path.join(feedbackDir, file), 'utf8'));
        // v1 migration: derive missing ticketId and default status
        if (!data.ticketId) {
          data.ticketId = generateTicketId(data.timestamp, data.sessionId || 'unknown', data.turnNumber ?? 0);
          data.status = data.status || 'new';
        }
        if (!data.status) data.status = 'new';
        if (sessionId && data.sessionId !== sessionId) continue;
        if (copilotName && data.copilotName !== copilotName) continue;
        if (from && data.timestamp < new Date(from).getTime()) continue;
        if (to && data.timestamp > new Date(to).getTime()) continue;
        if (status && data.status !== status) continue;
        entries.push(data);
      }
      // Sort by timestamp descending (can't rely on filename order with ticketId filenames)
      entries.sort((a, b) => b.timestamp - a.timestamp);
      entries = entries.slice(0, parseInt(limit));
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read feedback' });
    }
  });
```

Add new route for single ticket lookup. **Important:** this route must be registered AFTER `GET /` but uses a param pattern — Express 5 handles this correctly:

```typescript
  router.get('/:ticketId', async (req, res) => {
    const { ticketId } = req.params;
    const filePath = path.join(feedbackDir, `${ticketId}.json`);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      res.json(data);
    } catch {
      // Try scanning for v1 files
      try {
        const files = await fs.readdir(feedbackDir);
        for (const file of files) {
          const data = JSON.parse(await fs.readFile(path.join(feedbackDir, file), 'utf8'));
          const derived = data.ticketId || generateTicketId(data.timestamp, data.sessionId || 'unknown', data.turnNumber ?? 0);
          if (derived === ticketId) {
            if (!data.ticketId) { data.ticketId = derived; data.status = data.status || 'new'; }
            res.json(data);
            return;
          }
        }
      } catch { /* directory may not exist */ }
      res.status(404).json({ error: 'Feedback not found' });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/feedbackRoutes.ts packages/server/src/__tests__/feedbackRoutes.test.ts
git commit -m "feat(server): GET feedback with status filter, ticketId lookup, v1 migration"
```

---

## Task 4: PATCH endpoint — status transitions

**Files:**
- Modify: `packages/server/src/feedbackRoutes.ts`
- Modify: `packages/server/src/__tests__/feedbackRoutes.test.ts`

- [ ] **Step 1: Write tests for PATCH /:ticketId**

```typescript
describe('PATCH /api/feedback/:ticketId', () => {
  it('updates status and sets updatedAt', async () => {
    const feedbackDir = path.join(tmpDir, 'feedback');
    await fs.writeFile(path.join(feedbackDir, 'FB-AAAA.json'),
      JSON.stringify({ ticketId: 'FB-AAAA', status: 'new', text: 'test', timestamp: 1000 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/feedback/FB-AAAA`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'triaged', rootCause: 'sparse-tool-data', notes: 'Missing fields' }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('triaged');

    // Verify file was updated
    const stored = JSON.parse(await fs.readFile(path.join(feedbackDir, 'FB-AAAA.json'), 'utf8'));
    expect(stored.status).toBe('triaged');
    expect(stored.rootCause).toBe('sparse-tool-data');
    expect(stored.notes).toBe('Missing fields');
    expect(stored.updatedAt).toBeGreaterThan(0);
  });

  it('rejects invalid status', async () => {
    const feedbackDir = path.join(tmpDir, 'feedback');
    await fs.writeFile(path.join(feedbackDir, 'FB-AAAA.json'),
      JSON.stringify({ ticketId: 'FB-AAAA', status: 'new', text: 'test', timestamp: 1000 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/feedback/FB-AAAA`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects notes over 2000 chars', async () => {
    const feedbackDir = path.join(tmpDir, 'feedback');
    await fs.writeFile(path.join(feedbackDir, 'FB-AAAA.json'),
      JSON.stringify({ ticketId: 'FB-AAAA', status: 'new', text: 'test', timestamp: 1000 }));

    const res = await fetch(`http://127.0.0.1:${port}/api/feedback/FB-AAAA`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'triaged', notes: 'x'.repeat(2001) }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown ticket', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/feedback/FB-ZZZZ`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'triaged' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: FAIL — no PATCH route exists.

- [ ] **Step 3: Add PATCH handler**

Add after the `GET /:ticketId` route in `feedbackRoutes.ts`:

```typescript
  const VALID_STATUSES = new Set(['new', 'triaged', 'dismissed', 'confirmed', 'fixed']);

  router.patch('/:ticketId', async (req, res) => {
    const { ticketId } = req.params;
    const { status, rootCause, notes } = req.body;
    if (status && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }
    if (notes && notes.length > 2000) {
      return res.status(400).json({ error: 'Notes must be 2000 characters or fewer' });
    }
    const filePath = path.join(feedbackDir, `${ticketId}.json`);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (status) data.status = status;
      if (rootCause !== undefined) data.rootCause = rootCause;
      if (notes !== undefined) data.notes = notes;
      data.updatedAt = Date.now();
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      res.json({ ok: true, ticketId, status: data.status });
    } catch {
      res.status(404).json({ error: 'Feedback not found' });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test -- feedbackRoutes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/feedbackRoutes.ts packages/server/src/__tests__/feedbackRoutes.test.ts
git commit -m "feat(server): PATCH /api/feedback/:ticketId for status transitions"
```

---

## Task 5: Export new types from server package index

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Update exports**

At `packages/server/src/index.ts:71`, the existing export is:
```typescript
export type { FeedbackEntry } from './feedbackRoutes.js';
```

Add `generateTicketId` to the function export on line 70:
```typescript
export { createFeedbackRoutes, generateTicketId } from './feedbackRoutes.js';
export type { FeedbackEntry } from './feedbackRoutes.js';
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/server && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): export generateTicketId from package index"
```

---

## Task 6: UI — show ticket ID with copy button after submission

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx` (state + fetch handler)
- Modify: `packages/ui/src/components/VoiceTranscript.tsx` (report pill display)

- [ ] **Step 1: Add Copy and Check imports to VoiceTranscript.tsx**

At the lucide-react import line in `VoiceTranscript.tsx`, add `Copy` and `Check`:

Find the existing `import { ... } from 'lucide-react'` and add `Copy, Check` to it.

- [ ] **Step 2: Update GlassCopilotPanel state — track ticket ID instead of just turn number**

In `GlassCopilotPanel.tsx`, change `feedbackSentTurn` from `number | null` to `{ turnNumber: number; ticketId: string } | null`:

At line 917, change:
```typescript
const [feedbackSentTurn, setFeedbackSentTurn] = useState<number | null>(null);
```
to:
```typescript
const [feedbackSentTurn, setFeedbackSentTurn] = useState<{ turnNumber: number; ticketId: string } | null>(null);
```

- [ ] **Step 3: Update handleFeedbackSubmit to capture ticketId from response**

At lines 1032-1055, update `handleFeedbackSubmit`:

```typescript
  const handleFeedbackSubmit = useCallback(async (text: string, target: { assistantMessage: string; userMessage?: string; turnNumber: number }) => {
    const backendUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';
    const url = backendUrl ? `${backendUrl}/api/feedback` : '/api/feedback';
    try {
      const res = await fetch(url, {
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
          kitVersion: __KIT_VERSION__,
        }),
      });
      const body = await res.json().catch(() => ({ ticketId: undefined }));
      setFeedbackSentTurn({ turnNumber: target.turnNumber, ticketId: body.ticketId || '✓' });
      setTimeout(() => setFeedbackSentTurn(null), 4000);
    } catch { /* silent — feedback is best-effort */ }
    setFeedbackTarget(null);
  }, [sessionId, config.copilotName, lastTimings]);
```

Key changes: parse response JSON for `ticketId`, store both `turnNumber` and `ticketId` in state, extend timeout from 2s to 4s.

- [ ] **Step 3b: Add early-dismiss on click/scroll**

Per spec: "If user clicks elsewhere or scrolls, confirmation dismisses early." Add a `useEffect` that listens for click and scroll events while `feedbackSentTurn` is set:

```typescript
  // Early dismiss ticket confirmation on click/scroll
  useEffect(() => {
    if (!feedbackSentTurn) return;
    const dismiss = () => setFeedbackSentTurn(null);
    // Use setTimeout to avoid dismissing from the submit click itself
    const timer = setTimeout(() => {
      window.addEventListener('click', dismiss, { once: true });
      window.addEventListener('scroll', dismiss, { once: true, capture: true });
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', dismiss);
      window.removeEventListener('scroll', dismiss);
    };
  }, [feedbackSentTurn]);
```

Place this near the other `feedbackSentTurn` state management (around line 917).

- [ ] **Step 4: Update VoiceTranscript props type**

Change the `feedbackSentTurn` prop type from `number | null` to `{ turnNumber: number; ticketId: string } | null`:

In `VoiceTranscript.tsx` props interface (around line 95):
```typescript
feedbackSentTurn?: { turnNumber: number; ticketId: string } | null;
```

And in `GlassCopilotPanel.tsx` props interface (around line 738):
```typescript
feedbackSentTurn?: { turnNumber: number; ticketId: string } | null;
```

- [ ] **Step 5: Extract FeedbackPill component and update report pill rendering**

First, add a `FeedbackPill` component near the top of `VoiceTranscript.tsx` (after imports, before the main component). This is necessary because we need `useState` for the copy-button feedback, and hooks cannot be called inside IIFEs or render callbacks.

```tsx
function FeedbackPill({ isSent, ticketId, onReport }: {
  isSent: boolean;
  ticketId: string | null;
  onReport: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      disabled={isSent}
      onClick={() => { if (!isSent) onReport(); }}
      className="voice-feedback-pill"
      style={{
        marginTop: 2,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 8,
        border: isSent ? '1px solid rgba(217,119,6,0.3)' : '1px solid rgba(0,0,0,0.12)',
        background: 'transparent',
        color: isSent ? '#92400e' : 'rgba(0,0,0,0.30)',
        cursor: isSent ? 'default' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        opacity: isSent ? 1 : 0,
        transition: 'opacity 0.15s, color 0.15s',
        fontFamily: isSent ? 'monospace' : 'inherit',
      }}
    >
      {isSent && ticketId ? (
        <>
          {ticketId}
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(ticketId).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            style={{ cursor: 'pointer', display: 'inline-flex', marginLeft: 2 }}
          >
            {copied ? <Check size={10} strokeWidth={2} /> : <Copy size={10} strokeWidth={2} />}
          </span>
        </>
      ) : (
        <>
          <Flag size={10} strokeWidth={2} />
          Feedback
        </>
      )}
    </button>
  );
}
```

Then replace the existing IIFE at lines 481-512 with:

```tsx
{isAI && (!isLast || !isTyping) && onReport && (() => {
  const turnNumber = visible.slice(0, idx + 1).filter(m => m.role === 'assistant').length;
  const isSent = feedbackSentTurn?.turnNumber === turnNumber;
  return (
    <FeedbackPill
      isSent={isSent}
      ticketId={isSent ? feedbackSentTurn.ticketId : null}
      onReport={() => {
        const userMsg = visible.slice(0, idx).reverse().find(m => m.role === 'user');
        onReport(turnNumber, msg.text, userMsg?.text);
      }}
    />
  );
})()}
```

- [ ] **Step 6: Typecheck the UI package**

Run: `cd packages/ui && pnpm typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/GlassCopilotPanel.tsx packages/ui/src/components/VoiceTranscript.tsx
git commit -m "feat(ui): show ticket ID with copy button after feedback submission"
```

---

## Task 7: Update marketplace triage skill for v2

**Files:**
- Modify: `/Users/moulaymehdi/.claude/plugins/marketplaces/unctad-digital-government/plugins/voice-agent/skills/feedback-triage/SKILL.md`
- Modify: `/Users/moulaymehdi/.claude/plugins/marketplaces/unctad-digital-government/plugins/voice-agent/commands/feedback-triage.md`

**Note:** This is a separate git repo at `/Users/moulaymehdi/.claude/plugins/marketplaces/unctad-digital-government/`. Commits must target that repo.

- [ ] **Step 1: Update SKILL.md — add PATCH step, default status filter, ticket IDs in report**

In `SKILL.md`, make three changes:

**a) Step 3 — default to `?status=new`:**
Change the fetch URL to:
```
GET {siteUrl}/api/feedback?status=new&limit={limit}&from={from}&to={to}
```
Add note: "Use `?status=new` by default to show only untriaged entries. Pass `--status all` to see everything."

**b) After Step 7 (Report) — add Step 8: Update Status:**

```markdown
## Step 8: Update Status

After analyzing each entry, update its status via the PATCH API:

```
PATCH {siteUrl}/api/feedback/{ticketId}
Content-Type: application/json

{
  "status": "triaged",
  "rootCause": "{category from Step 6}",
  "notes": "{one-line summary of diagnosis}"
}
```

Use `WebFetch` with method PATCH. This prevents re-triaging the same entry in future runs.
```

**c) Step 7 report format — use ticket IDs:**
Change the report template from `### Feedback #{n}` to `### {ticketId}`:

```markdown
### FB-7K3M: "{complaint text}"
```

- [ ] **Step 2: Update command — add --status flag**

In `commands/feedback-triage.md`, update the argument-hint and usage:

```markdown
---
description: Triage user feedback from a voice agent deployment
argument-hint: <site> [--from DATE] [--to DATE] [--limit N] [--status STATUS]
allowed-tools: [Read, WebFetch, Bash, Grep, Glob]
---
```

Add to parse instructions:
- `--status` filter: `new` (default), `triaged`, `confirmed`, `dismissed`, `fixed`, or `all`

- [ ] **Step 3: Commit in marketplace repo**

```bash
cd /Users/moulaymehdi/.claude/plugins/marketplaces/unctad-digital-government
git add plugins/voice-agent/skills/feedback-triage/SKILL.md plugins/voice-agent/commands/feedback-triage.md
git commit -m "feat(voice-agent): update triage skill for feedback v2 (ticket IDs + lifecycle)"
```

---

## Task 8: Build and typecheck all packages

- [ ] **Step 1: Build all packages**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`
Expected: All 4 packages build successfully.

- [ ] **Step 2: Typecheck all packages**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`
Expected: No type errors.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm --filter @unctad-ai/voice-agent-server test`
Expected: All tests pass including new feedbackRoutes tests.
