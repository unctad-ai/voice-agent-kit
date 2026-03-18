# Session Trace Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist structured session logs to disk and expose GET endpoints to retrieve full conversation traces by session ID.

**Architecture:** Extend `createSessionLogger` to buffer structured entries in memory alongside stdout. On WS close, flush to JSON file. New trace routes serve the data.

**Tech Stack:** Express router, Node.js fs, existing logger pattern

---

### Task 1: Add trace buffering to logger

**Files:**
- Modify: `packages/server/src/logger.ts:1-27`

- [ ] **Step 1: Add TraceEntry type and buffer to logger**

```ts
import { promises as fs } from 'fs';
import path from 'path';

export interface TraceEntry {
  turn: number;
  stage: string;
  detail: string;
  ms: number | null;
  ts: number;
  level: 'info' | 'warn' | 'error';
}

export function createSessionLogger(sessionId: string) {
  const sid = sessionId.slice(0, 8);
  let turn = 0;
  const entries: TraceEntry[] = [];
  const startedAt = Date.now();

  const prefix = () => `[${sid}:${turn}]`;

  return {
    get sid() { return sid; },
    get sessionId() { return sessionId; },
    setTurn(n: number) { turn = n; },
    info(stage: string, detail = '', ms?: number) {
      console.log(`${prefix()} ${stage}${detail ? ` ${detail}` : ''}${ms != null ? ` (${ms}ms)` : ''}`);
      entries.push({ turn, stage, detail, ms: ms ?? null, ts: Date.now(), level: 'info' });
    },
    warn(stage: string, ...args: unknown[]) {
      console.warn(`${prefix()} ${stage}`, ...args);
      entries.push({ turn, stage, detail: args.map(String).join(' '), ms: null, ts: Date.now(), level: 'warn' });
    },
    error(stage: string, ...args: unknown[]) {
      console.error(`${prefix()} ${stage}`, ...args);
      entries.push({ turn, stage, detail: args.map(String).join(' '), ms: null, ts: Date.now(), level: 'error' });
    },
    getEntries() { return entries; },
    async flush(dir: string) {
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, `${sessionId}.json`),
          JSON.stringify({ sessionId, startedAt, entries }, null, 2),
        );
      } catch (e) {
        console.error(`[${sid}] trace:flush-failed`, e);
      }
    },
  };
}

export type SessionLogger = ReturnType<typeof createSessionLogger>;
```

- [ ] **Step 2: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/logger.ts
git commit -m "feat(server): add trace buffering and flush to session logger"
```

---

### Task 2: Flush traces on session close

**Files:**
- Modify: `packages/server/src/createVoiceWebSocketHandler.ts:196-222`
- Modify: `packages/server/src/index.ts:35-38,56-60`
- Modify: `packages/server/src/types.ts:3-32`

- [ ] **Step 1: Add dataDir to VoiceServerOptions**

In `packages/server/src/types.ts`, add after `adminPassword`:

```ts
  /** Directory for persistent data (traces, feedback). Derived from personaDir if not set. */
  dataDir?: string;
```

- [ ] **Step 2: Flush on WS close**

In `packages/server/src/createVoiceWebSocketHandler.ts`, in the `ws.on('close')` handler (line 196), add after `logger.info('session:closed')` (line 221):

```ts
      // Flush session trace to disk
      if (options.dataDir) {
        logger.flush(join(options.dataDir, 'traces'));
      }
```

- [ ] **Step 3: Pass dataDir to WS handler**

In `packages/server/src/index.ts`, update the `createVoiceWebSocketHandler` call (line 35-38) to include `dataDir`:

```ts
  const dataDir = options.personaDir ? path.dirname(options.personaDir) : path.join(process.cwd(), 'data');

  const { broadcast } = createVoiceWebSocketHandler(server, {
    ...options,
    dataDir,
    getActiveVoiceId: personaStore ? () => personaStore!.getActiveVoiceId() : undefined,
  });
```

Move the `dataDir` computation before the WS handler call (it's currently inside the `if (app)` block at line 57). The feedback routes block should reuse the same `dataDir` variable.

- [ ] **Step 4: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/createVoiceWebSocketHandler.ts packages/server/src/index.ts packages/server/src/types.ts
git commit -m "feat(server): flush session traces to disk on WS close"
```

---

### Task 3: Trace retrieval routes

**Files:**
- Create: `packages/server/src/traceRoutes.ts`
- Modify: `packages/server/src/index.ts:56-60,63-72`

- [ ] **Step 1: Create traceRoutes.ts**

```ts
import { Router, type Router as RouterType } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

export function createTraceRoutes(dataDir: string): { router: RouterType } {
  const router = Router();
  const tracesDir = path.join(dataDir, 'traces');

  // List recent sessions (filenames + stat only, no file reads)
  router.get('/', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '20', 10);
      const files = await fs.readdir(tracesDir).catch(() => [] as string[]);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const sessions = await Promise.all(
        jsonFiles.map(async (f) => {
          const stat = await fs.stat(path.join(tracesDir, f));
          return {
            sessionId: f.replace('.json', ''),
            startedAt: stat.mtimeMs,
          };
        }),
      );

      sessions.sort((a, b) => b.startedAt - a.startedAt);
      res.json(sessions.slice(0, limit));
    } catch (err) {
      res.status(500).json({ error: 'Failed to list traces' });
    }
  });

  // Get single session trace
  router.get('/:sessionId', async (req, res) => {
    try {
      const sessionId = path.basename(req.params.sessionId);
      const filePath = path.join(tracesDir, `${sessionId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      res.json(JSON.parse(data));
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        res.status(404).json({ error: 'Trace not found' });
      } else {
        res.status(500).json({ error: 'Failed to read trace' });
      }
    }
  });

  return { router };
}
```

- [ ] **Step 2: Mount in index.ts and add exports**

In `packages/server/src/index.ts`, add import:

```ts
import { createTraceRoutes } from './traceRoutes.js';
```

In the `if (app)` block, after feedback routes, add:

```ts
    const { router: traceRouter } = createTraceRoutes(dataDir);
    app.use('/api/traces', traceRouter);
```

Add exports at the bottom:

```ts
export { createTraceRoutes } from './traceRoutes.js';
export type { TraceEntry } from './logger.js';
```

- [ ] **Step 3: Build and typecheck**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/traceRoutes.ts packages/server/src/index.ts
git commit -m "feat(server): trace retrieval routes (GET /api/traces)"
```

---

### Task 4: Final verification

- [ ] **Step 1: Build and typecheck all packages**

```bash
pnpm build && pnpm typecheck
```

- [ ] **Step 2: Manual testing**

1. Rebuild Docker: `pnpm docker:kenya`
2. Open panel, have a short conversation, close panel
3. `curl http://localhost:3000/api/traces` — should list the session
4. `curl http://localhost:3000/api/traces/{sessionId}` — should return full trace with entries
5. Verify entries have `turn`, `stage`, `detail`, `ms`, `ts`, `level` fields
6. Verify `docker logs` still shows the same stdout format as before
