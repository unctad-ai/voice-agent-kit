/**
 * Session-scoped logger — every line prefixed with [sid:turn] for end-to-end tracing.
 * Usage: create once per WebSocket connection, pass to pipeline, STT client, and TTS.
 */
export function createSessionLogger(sessionId: string) {
  const sid = sessionId.slice(0, 8);
  let turn = 0;

  const prefix = () => `[${sid}:${turn}]`;

  return {
    get sid() { return sid; },
    get sessionId() { return sessionId; },
    setTurn(n: number) { turn = n; },
    info(stage: string, detail = '', ms?: number) {
      console.log(`${prefix()} ${stage}${detail ? ` ${detail}` : ''}${ms != null ? ` (${ms}ms)` : ''}`);
    },
    warn(stage: string, ...args: unknown[]) {
      console.warn(`${prefix()} ${stage}`, ...args);
    },
    error(stage: string, ...args: unknown[]) {
      console.error(`${prefix()} ${stage}`, ...args);
    },
  };
}

export type SessionLogger = ReturnType<typeof createSessionLogger>;
