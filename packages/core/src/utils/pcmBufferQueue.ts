/**
 * Buffer queue for PCM audio chunks.
 * Accumulates chunks until a minimum buffer threshold is reached,
 * then flushes them for scheduling. This prevents choppy playback
 * from scheduling tiny chunks individually.
 *
 * Inspired by Unmute's RealtimeQueue pattern.
 */

const DEFAULT_MIN_BUFFER_CHUNKS = 4;

export class PcmBufferQueue {
  private buffer: ArrayBuffer[] = [];
  private flushed = false;
  private minChunks: number;

  constructor(minChunks = DEFAULT_MIN_BUFFER_CHUNKS) {
    this.minChunks = minChunks;
  }

  /**
   * Add a chunk to the buffer.
   * Returns chunks to schedule (empty array if still buffering).
   */
  push(chunk: ArrayBuffer): ArrayBuffer[] {
    this.buffer.push(chunk);

    // Once we've hit the threshold, flush immediately on every push
    if (this.flushed) {
      return [this.buffer.pop()!];
    }

    // Initial buffering: wait for minChunks
    if (this.buffer.length >= this.minChunks) {
      this.flushed = true;
      const chunks = this.buffer;
      this.buffer = [];
      return chunks;
    }

    return [];
  }

  /** Reset for a new response. */
  reset(): void {
    this.buffer = [];
    this.flushed = false;
  }

  /** Flush any remaining buffered chunks (e.g. at end of response). */
  flush(): ArrayBuffer[] {
    const chunks = this.buffer;
    this.buffer = [];
    this.flushed = false;
    return chunks;
  }
}
