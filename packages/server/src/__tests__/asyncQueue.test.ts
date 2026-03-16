import { describe, it, expect } from 'vitest';
import { AsyncQueue } from '../asyncQueue.js';

describe('AsyncQueue', () => {
  it('take() resolves when put() is called after', async () => {
    const q = new AsyncQueue<string>();
    const promise = q.take();
    q.put('hello');
    expect(await promise).toBe('hello');
  });

  it('take() resolves immediately if item was put() before', async () => {
    const q = new AsyncQueue<string>();
    q.put('buffered');
    expect(await q.take()).toBe('buffered');
  });

  it('multiple put/take pairs resolve in order (FIFO)', async () => {
    const q = new AsyncQueue<number>();
    q.put(1);
    q.put(2);
    q.put(3);
    expect(await q.take()).toBe(1);
    expect(await q.take()).toBe(2);
    expect(await q.take()).toBe(3);
  });

  it('cancel() rejects pending take()', async () => {
    const q = new AsyncQueue<string>();
    const promise = q.take();
    q.cancel();
    await expect(promise).rejects.toThrow('cancelled');
  });

  it('cancel() discards buffered items', () => {
    const q = new AsyncQueue<string>();
    q.put('a');
    q.put('b');
    q.cancel();
    // After cancel, a new take should hang (not resolve with old items)
    const promise = q.take();
    q.put('fresh');
    return expect(promise).resolves.toBe('fresh');
  });

  it('take() with AbortSignal rejects on abort', async () => {
    const q = new AsyncQueue<string>();
    const controller = new AbortController();
    const promise = q.take(controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
  });
});
