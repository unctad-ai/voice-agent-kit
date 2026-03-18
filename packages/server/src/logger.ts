/**
 * Session-scoped logger — every line prefixed with [sid:turn] for end-to-end tracing.
 * Usage: create once per WebSocket connection, pass to pipeline and STT client.
 */
export function createSessionLogger(sessionId: string) {
  const sid = sessionId.slice(0, 8);
  let turn = 0;

  return {
    get sid() { return sid; },
    get sessionId() { return sessionId; },
    setTurn(n: number) { turn = n; },
    info(stage: string, detail = '', ms?: number) {
      console.log(`[${sid}:${turn}] ${stage}${detail ? ` ${detail}` : ''}${ms != null ? ` (${ms}ms)` : ''}`);
    },
    error(stage: string, ...args: unknown[]) {
      console.error(`[${sid}:${turn}] ${stage}`, ...args);
    },
  };
}

export type SessionLogger = ReturnType<typeof createSessionLogger>;
