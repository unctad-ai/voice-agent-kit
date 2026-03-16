/**
 * A simple async FIFO queue with cancellation support.
 * Inspired by Unmute's QuestManager pattern.
 *
 * - put(item): enqueue an item (resolves a waiting take, or buffers)
 * - take(signal?): dequeue an item (waits if empty, abortable)
 * - cancel(): reject all pending takes and clear the buffer
 */
export class AsyncQueue<T> {
  private buffer: T[] = [];
  private waiters: Array<{
    resolve: (value: T) => void;
    reject: (reason: Error) => void;
  }> = [];

  /** Enqueue an item. If a consumer is waiting, deliver directly. */
  put(item: T): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve(item);
    } else {
      this.buffer.push(item);
    }
  }

  /** Dequeue an item. Waits if the buffer is empty. */
  take(signal?: AbortSignal): Promise<T> {
    if (this.buffer.length > 0) {
      return Promise.resolve(this.buffer.shift()!);
    }

    return new Promise<T>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);

      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
          reject(new Error('cancelled'));
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Reject all pending takes and clear the buffer. */
  cancel(): void {
    for (const waiter of this.waiters) {
      waiter.reject(new Error('cancelled'));
    }
    this.waiters = [];
    this.buffer = [];
  }
}
