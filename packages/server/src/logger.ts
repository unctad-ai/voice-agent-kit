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

/**
 * Session-scoped logger — every line prefixed with [sid:turn] for end-to-end tracing.
 * Usage: create once per WebSocket connection, pass to pipeline, STT client, and TTS.
 */
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
