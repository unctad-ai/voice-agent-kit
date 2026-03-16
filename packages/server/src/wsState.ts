/**
 * WebSocket connection state machine.
 * Guards all send/close operations to prevent crashes on invalid states.
 */
export enum WsState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

/** Valid state transitions */
const TRANSITIONS: Record<WsState, Set<WsState>> = {
  [WsState.CONNECTING]: new Set([WsState.OPEN, WsState.CLOSED]),
  [WsState.OPEN]: new Set([WsState.CLOSING, WsState.CLOSED]),
  [WsState.CLOSING]: new Set([WsState.CLOSED]),
  [WsState.CLOSED]: new Set(),
};

/** Returns true if data can be sent (only in OPEN state). */
export function canSend(state: WsState): boolean {
  return state === WsState.OPEN;
}

/** Returns true if the connection can be closed (CONNECTING or OPEN). */
export function canClose(state: WsState): boolean {
  return state === WsState.CONNECTING || state === WsState.OPEN;
}

/**
 * Attempt a state transition. Returns the new state if valid,
 * or the current state if the transition is not allowed.
 */
export function transitionTo(current: WsState, target: WsState): WsState {
  return TRANSITIONS[current].has(target) ? target : current;
}
