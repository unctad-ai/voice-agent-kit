# Session Trace Retrieval

**Goal:** Persist structured session logs to disk and expose a GET API to retrieve full conversation traces by session ID, enabling feedback-to-trace correlation.

## Architecture

Extend the existing `createSessionLogger` to buffer structured entries in memory alongside the existing `console.log` output. On session close, flush the buffer to a JSON file on disk. A new GET endpoint serves traces by session ID.

## Storage

Same pattern as feedback — JSON files in `{dataDir}/traces/{sessionId}.json`. Each file contains:

```json
{
  "sessionId": "full-uuid",
  "startedAt": 1773845013157,
  "entries": [
    { "turn": 1, "stage": "turn:start", "detail": "route=/dashboard", "ms": null, "ts": 1773845013200, "level": "info" },
    { "turn": 1, "stage": "stt:done", "detail": "\"hello\"", "ms": 133, "ts": 1773845013333, "level": "info" },
    { "turn": 1, "stage": "llm:done", "detail": "\"How can I help?\"", "ms": 868, "ts": 1773845014201, "level": "info" }
  ]
}
```

## API

- `GET /api/traces/:sessionId` — returns the full trace JSON, 404 if not found
- `GET /api/traces` — lists recent sessions with metadata (sessionId, startedAt, entryCount), sorted by recency, paginated via `?limit=20`. Reads filenames only (no file content) — the timestamp is encoded in the file's mtime.

## Changes

### `packages/server/src/logger.ts`

- Add an internal `entries: TraceEntry[]` array to the logger object
- `info(stage, detail, ms)` pushes `{ turn, stage, detail, ms, ts, level: 'info' }` alongside `console.log`
- `warn(stage, ...args)` pushes `{ turn, stage, detail: args.map(String).join(' '), ms: null, ts, level: 'warn' }` alongside `console.warn`
- `error(stage, ...args)` pushes `{ turn, stage, detail: args.map(String).join(' '), ms: null, ts, level: 'error' }` alongside `console.error`
- Add `flush(dir: string): Promise<void>` — writes `{ sessionId, startedAt, entries }` to `{dir}/{sessionId}.json`. Errors are caught and logged to stderr (never throws — must not break WS close).
- Add `getEntries()` accessor for testing
- Export `TraceEntry` type

### `packages/server/src/createVoiceWebSocketHandler.ts`

- Accept `dataDir` in the handler options (consistent with other route handlers)
- On WebSocket close (where `session:closed` is logged), call `logger.flush(path.join(dataDir, 'traces'))` to persist the trace
- In-memory entries are lost if the process crashes before close — acceptable trade-off for simplicity

### `packages/server/src/traceRoutes.ts` (new)

- `createTraceRoutes(dataDir: string)` — returns an Express router
- `GET /` — reads `{dataDir}/traces/` directory, returns array of `{ sessionId, startedAt, entryCount }` from filenames + stat mtime, with `?limit` query param (default 20)
- `GET /:sessionId` — reads and returns the JSON file, 404 if missing

### `packages/server/src/index.ts`

- Import and mount trace routes at `/api/traces`
- Pass `dataDir` to `createVoiceWebSocketHandler` options
- Export `createTraceRoutes` and `TraceEntry` type

## Constraints

- No changes to existing stdout log output — the buffer is additive
- Traces persist indefinitely (same as feedback files)
- No authentication on trace endpoints (same as feedback)
- List endpoint reads filenames/stats only, not file contents — scales to thousands of sessions
