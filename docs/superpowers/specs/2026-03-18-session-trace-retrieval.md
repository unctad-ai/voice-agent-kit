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
    { "turn": 1, "stage": "turn:start", "detail": "route=/dashboard", "ms": null, "ts": 1773845013200 },
    { "turn": 1, "stage": "stt:done", "detail": "\"hello\"", "ms": 133, "ts": 1773845013333 },
    { "turn": 1, "stage": "llm:done", "detail": "\"How can I help?\"", "ms": 868, "ts": 1773845014201 }
  ]
}
```

## API

- `GET /api/traces/:sessionId` — returns the full trace JSON, 404 if not found
- `GET /api/traces` — lists recent sessions with metadata (sessionId, startedAt, entryCount), paginated via `?limit=20`

## Changes

### `packages/server/src/logger.ts`

- Add an internal `entries: TraceEntry[]` array to the logger object
- Each `info()`, `warn()`, `error()` call pushes a structured `{ turn, stage, detail, ms, ts, level }` entry alongside the existing `console.log/warn/error`
- Add `flush(dir: string): Promise<void>` — writes the entries array to `{dir}/{sessionId}.json`
- Add `getEntries()` accessor for testing
- Export `TraceEntry` type

### `packages/server/src/createVoiceWebSocketHandler.ts`

- Accept `tracesDir` in the handler options
- On WebSocket close (where `session:closed` is logged), call `logger.flush(tracesDir)` to persist the trace

### `packages/server/src/traceRoutes.ts` (new)

- `createTraceRoutes(dataDir: string)` — returns an Express router
- `GET /` — reads `{dataDir}/traces/` directory, returns array of `{ sessionId, startedAt, entryCount }` sorted by recency, with `?limit` query param (default 20)
- `GET /:sessionId` — reads and returns the JSON file, 404 if missing

### `packages/server/src/index.ts`

- Import and mount trace routes at `/api/traces`
- Pass `tracesDir` path to `createVoiceWebSocketHandler` options

## Constraints

- No changes to existing stdout log output — the buffer is additive
- Traces persist indefinitely (same as feedback files)
- No authentication on trace endpoints (same as feedback)
