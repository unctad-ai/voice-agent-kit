# TTS Migration: Custom Fork → vLLM-Omni

**Date:** 2026-03-17
**Status:** Approved
**Evidence:** `docs/superpowers/prompts/migrate-to-vllm-omni.md`

## Problem

The custom Qwen3-TTS fork (`rekuenkdr/Qwen3-TTS-streaming`) deadlocks the GPU when clients disconnect mid-stream. The Python generator holds a `threading.Lock` inside a CUDA C-extension — `GeneratorExit` cannot be delivered until the kernel returns, so `lock.release()` never runs. A 45s watchdog is a band-aid. Every barge-in risks a 45s TTS outage.

Production inference servers (vLLM, TGI, Triton) all solve this with the same pattern: GPU work on a background thread, results via queue, API layer never touches CUDA. Our fork does the opposite.

## Solution

Replace the fork with **vLLM-Omni v0.16.0** — Qwen's official production TTS server. Same model (`Qwen3-TTS-12Hz-1.7B-Base`), same voice cloning (ICL with ref audio), same output format (24kHz Int16 PCM). No GPU lock — native async engine with CUDA Graphs.

## Architecture Change

```
Before: Node.js → POST /tts-pipeline (form-urlencoded) → WAV stream (44-byte header + PCM)
After:  Node.js → POST /v1/audio/speech (JSON, stream:true) → raw PCM stream (no header)
```

## GPU Server Fit

- Host: `5.9.49.171`, RTX 4000 SFF Ada (20GB VRAM)
- Current: STT ~3GB + TTS ~4.5GB = 7.6GB
- After: STT ~3GB + vLLM-Omni ~6-8GB = 9-11GB (fits in 20GB)

## Kit Changes

### 1. `packages/server/src/ttsProviders.ts`

Add `synthesizeWithVllmOmni()`:
```typescript
export async function synthesizeWithVllmOmni(
  text: string,
  url: string,
  signal?: AbortSignal,
  opts?: { refAudio?: string; refText?: string }
): Promise<Response> {
  const providerTimeout = AbortSignal.timeout(50_000);
  return fetch(`${url}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: text,
      task_type: 'Base',
      ref_audio: opts?.refAudio,
      ref_text: opts?.refText,
      stream: true,
      response_format: 'pcm',
    }),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}
```

Update `TtsProviderConfig` to add `vllmOmniUrl`, `ttsRefAudio`, `ttsRefText`.

Update `synthesize()` router to handle `ttsProvider: 'vllm-omni'`.

### 2. `packages/server/src/voicePipeline.ts`

`streamTtsAudio` currently strips a 44-byte WAV header from the first chunk. vLLM-Omni with `response_format: pcm` returns raw PCM — no header to strip.

Add a `rawPcm` flag to `TtsProviderConfig` (true when provider is `vllm-omni`). When `rawPcm` is true, skip the header stripping in `streamTtsAudio`.

### 3. GPU server deployment

New `gpu-services/vllm-omni-tts/docker-compose.yml`:
```yaml
services:
  vllm-omni-tts:
    image: vllm/vllm-omni:v0.16.0
    runtime: nvidia
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    ports:
      - "8091:8091"
    volumes:
      - /root/.cache/huggingface:/root/.cache/huggingface
      - /home/mehdi/qwen3-tts/voices:/app/voices
    ipc: host
    command: >
      --model Qwen/Qwen3-TTS-12Hz-1.7B-Base
      --stage-configs-path vllm_omni/model_executor/stage_configs/qwen3_tts.yaml
      --omni --port 8091 --trust-remote-code --enforce-eager
```

Deploy alongside current TTS (port 8005) for A/B comparison.

### 4. Consuming project `.env`

```
TTS_PROVIDER=vllm-omni
VLLM_OMNI_URL=http://5.9.49.171:8091
TTS_REF_AUDIO=file:///app/voices/pesa/voice.wav
TTS_REF_TEXT=<transcript of reference audio>
```

## What Does NOT Change

- STT (Kyutai/Moshi) — untouched
- LLM (Groq qwen3-32b) — untouched
- Client code (core/ui/registries) — untouched
- Other TTS providers (pocket-tts, chatterbox, cosyvoice, resemble) — untouched, still available as fallbacks
- Voice cloning workflow — same ICL mode, same reference audio files

## Rollback

Keep the current fork running on port 8005. If vLLM-Omni fails, change `TTS_PROVIDER` back to `qwen3-tts`. Zero downtime.

## Phased Rollout

1. **Deploy vLLM-Omni** on GPU server port 8091 (alongside current TTS on 8005)
2. **Verify** voice cloning + streaming with curl
3. **Add provider** to kit, build, deploy to Swkenya with `VLLM_OMNI_URL`
4. **A/B test** — compare TTFA, RTF, audio quality
5. **Switch** production env to `vllm-omni` if quality matches or exceeds
6. **Decommission** old fork

## Success Criteria

- No TTS deadlocks after barge-in (the primary goal)
- TTFA <= 300ms (current: ~400ms, vLLM-Omni expected: 150-200ms)
- Voice quality matches current (same model, same reference audio)
- All existing TTS providers still work as fallbacks
- 10 consecutive multi-turn conversations complete without TTS drops

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Temperature not supported in vLLM-Omni | Less expressive voice | Use `instructions` field for style guidance |
| VRAM pressure (STT + vLLM) | OOM | Monitor `nvidia-smi`; 3GB + 8GB = 11GB < 20GB |
| Model download on first start | 5min cold start | Pre-pull model, mount HF cache |
| vLLM-Omni bugs | TTS failures | Keep fork running as fallback on port 8005 |
