# Fix TTS GPU Lock Deadlock

## Problem

The qwen3-tts streaming endpoint (`/tts-pipeline`) permanently deadlocks the GPU lock when a client disconnects mid-stream. After one cancelled request, ALL subsequent TTS requests get 503 "GPU busy" until the container is manually restarted. A watchdog band-aid auto-releases the lock after 45 seconds, but this means 45 seconds of broken TTS after every barge-in.

## Root Cause (verified)

The `/tts-pipeline` endpoint uses a Python generator that holds `gpu_lock` while iterating `model.stream_generate_voice_clone()`. When the HTTP client disconnects mid-stream (e.g., pipeline cancel on barge-in), Starlette raises `GeneratorExit` to finalize the generator. But the generator is suspended inside a CUDA kernel (C-extension call) — Python cannot deliver `GeneratorExit` until the kernel returns. If the kernel takes long, the `finally` block with `gpu_lock.release()` never executes, and the lock is held forever.

Run `node scripts/test-tts.mjs` to reproduce — the "Cancel + Recovery" test confirms the deadlock.

## The Fix: Background Thread + Queue

Don't run the CUDA generator inside the HTTP response generator. Instead:

```python
import queue, threading

@app.post("/tts-pipeline")
async def tts_pipeline(text, temperature):
    q = queue.Queue(maxsize=100)
    stop = threading.Event()

    def worker():
        gpu_lock.acquire()
        try:
            for chunk_audio, sr in model.stream_generate_voice_clone(...):
                if stop.is_set():
                    break
                try:
                    q.put(float32_to_pcm16(chunk_audio), timeout=5)
                except queue.Full:
                    logger.warning("TTS queue full — consumer likely disconnected")
                    break
            q.put(None)  # sentinel: generation complete
        except Exception as e:
            logger.error("TTS worker error: %s", e)
            q.put(e)  # propagate error
        finally:
            gpu_lock.release()
            torch.cuda.empty_cache()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    def stream_from_queue():
        try:
            yield build_wav_header(sample_rate)
            while True:
                try:
                    item = q.get(timeout=30)
                except queue.Empty:
                    logger.warning("TTS queue read timeout — worker may be stuck")
                    break
                if item is None:
                    break  # done
                if isinstance(item, Exception):
                    logger.error("TTS worker reported error: %s", item)
                    break
                yield item
        finally:
            stop.set()  # signal worker to stop on client disconnect

    return StreamingResponse(stream_from_queue(), media_type="audio/wav")
```

**How client disconnect is handled:**

When the client disconnects, Starlette raises `GeneratorExit` on `stream_from_queue()`. Since the generator is blocked on `q.get()` (pure Python, not a CUDA kernel), the exception is delivered cleanly. The `finally` block runs `stop.set()`, signaling the worker thread. The worker sees `stop.is_set()` on its next loop iteration, breaks out, and releases `gpu_lock` in its own `finally` block.

**Why `q.get()` is interruptible but CUDA isn't:** `queue.Queue.get()` uses a Python `Condition` internally — pure Python code that cooperates with exceptions. The CUDA kernel is a C-extension call that blocks the GIL; Python cannot inject `GeneratorExit` until the C code returns.

**Why `q.put(timeout=5)` is needed:** Even with `stop.set()`, there's a race window: the worker checks `stop.is_set()`, gets False, then the consumer disconnects and sets `stop`, then the worker calls `q.put()` on a full queue. Without a timeout, the worker blocks forever holding `gpu_lock`. The 5s timeout ensures the worker retries the `stop` check.

## File to modify

`/Users/moulaymehdi/PROJECTS/figma/gpu-services/qwen3-tts/server.py`

Only the `/tts-pipeline` endpoint needs this change. The `/tts` (non-streaming) endpoint is already safe because `generate_voice_clone()` runs to completion atomically.

## What to keep

- The `gpu_lock` serialization — still needed, just acquired/released in the thread
- The two-phase streaming parameters (FIRST_CHUNK_EMIT_EVERY, etc.)
- The `gpu_lock.locked()` fast-reject before starting the thread — if the lock is already held, return 503 immediately (don't even spawn a thread)
- The watchdog wrapper (`_WatchdogGpuLock`) — keep as a safety net, but note the interaction: if the watchdog force-releases the lock while the worker thread is blocked (e.g., on a full queue), the worker's `finally: gpu_lock.release()` would release a lock acquired by a *different* request. The `q.put(timeout=5)` fix above prevents this scenario by ensuring the worker never blocks long enough to trigger the watchdog
- The WAV header as the first yield
- The PCM Int16 conversion
- The max audio duration cap
- The logging (TTFA, RTF, total time)

## Verification

```bash
# 1. Run the TTS eval
node scripts/test-tts.mjs $QWEN3_TTS_URL  # e.g. http://gpu-host:8005

# Expected: Cancel + Recovery test should PASS
# Before fix: FAIL (GPU lock stuck after cancel)
# After fix: PASS (lock released cleanly by worker thread)

# 2. Verify streaming still works
# The /tts-pipeline responses should still have TTFA ~200ms
# and stream chunks incrementally (not all at once)

# 3. Verify non-streaming still works
# /tts endpoint should be unchanged

# 4. Run the full pipeline eval
node scripts/test-pipeline.mjs ws://localhost:3000/api/voice
# Tests 5 and 6 should no longer get 503
```

## Deploy

```bash
# After fixing server.py locally:
cd /Users/moulaymehdi/PROJECTS/figma/gpu-services
git add qwen3-tts/server.py
git commit -m "fix(tts): use background thread for streaming to prevent GPU lock deadlock"
git push origin main

# Deploy to GPU server:
scp qwen3-tts/server.py gpu-server:~/qwen3-tts/server.py
ssh gpu-server "cd ~/qwen3-tts && docker compose down && docker compose up --build -d"

# Verify:
node scripts/test-tts.mjs
```
