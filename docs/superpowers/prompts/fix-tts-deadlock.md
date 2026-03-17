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
                q.put(float32_to_pcm16(chunk_audio))
            q.put(None)  # sentinel: generation complete
        except Exception as e:
            q.put(e)  # propagate error
        finally:
            gpu_lock.release()
            torch.cuda.empty_cache()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    def stream_from_queue():
        yield build_wav_header(sample_rate)
        while True:
            item = q.get(timeout=30)
            if item is None:
                break  # done
            if isinstance(item, Exception):
                break  # error
            yield item

    return StreamingResponse(stream_from_queue(), media_type="audio/wav")
```

When the client disconnects, `GeneratorExit` hits `stream_from_queue()` — which is just reading from a Python queue, not running CUDA. The `GeneratorExit` is delivered cleanly. The background `worker` thread finishes its current CUDA decode step (microseconds), checks `stop.is_set()` (not strictly necessary since the queue consumer is gone, but clean), and releases the lock in the `finally` block.

**Why this works:** `GeneratorExit` only needs to interrupt a `q.get()` call, not a CUDA kernel. Python can always interrupt `queue.Queue.get()`.

## File to modify

`/Users/moulaymehdi/PROJECTS/figma/gpu-services/qwen3-tts/server.py`

Only the `/tts-pipeline` endpoint needs this change. The `/tts` (non-streaming) endpoint is already safe because `generate_voice_clone()` runs to completion atomically.

## What to keep

- The `gpu_lock` serialization — still needed, just acquired/released in the thread
- The two-phase streaming parameters (FIRST_CHUNK_EMIT_EVERY, etc.)
- The `gpu_lock.locked()` fast-reject before starting the thread — if the lock is already held, return 503 immediately (don't even spawn a thread)
- The watchdog wrapper (`_WatchdogGpuLock`) — keep as a safety net even though the new pattern should prevent deadlocks
- The WAV header as the first yield
- The PCM Int16 conversion
- The max audio duration cap
- The logging (TTFA, RTF, total time)

## Verification

```bash
# 1. Run the TTS eval
node scripts/test-tts.mjs http://5.9.49.171:8005

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
