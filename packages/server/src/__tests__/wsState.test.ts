import { describe, it, expect } from 'vitest';
import { WsState, canSend, canClose, transitionTo } from '../wsState.js';

describe('WsState', () => {
  it('canSend is true only in OPEN state', () => {
    expect(canSend(WsState.CONNECTING)).toBe(false);
    expect(canSend(WsState.OPEN)).toBe(true);
    expect(canSend(WsState.CLOSING)).toBe(false);
    expect(canSend(WsState.CLOSED)).toBe(false);
  });

  it('canClose is true in CONNECTING and OPEN states', () => {
    expect(canClose(WsState.CONNECTING)).toBe(true);
    expect(canClose(WsState.OPEN)).toBe(true);
    expect(canClose(WsState.CLOSING)).toBe(false);
    expect(canClose(WsState.CLOSED)).toBe(false);
  });

  it('transitionTo validates allowed transitions', () => {
    expect(transitionTo(WsState.CONNECTING, WsState.OPEN)).toBe(WsState.OPEN);
    expect(transitionTo(WsState.CONNECTING, WsState.CLOSED)).toBe(WsState.CLOSED);
    expect(transitionTo(WsState.OPEN, WsState.CLOSING)).toBe(WsState.CLOSING);
    expect(transitionTo(WsState.CLOSING, WsState.CLOSED)).toBe(WsState.CLOSED);
    // Invalid: CLOSED -> OPEN
    expect(transitionTo(WsState.CLOSED, WsState.OPEN)).toBe(WsState.CLOSED);
  });
});
