# vLLM-Omni TTS Deployment Findings

**Date:** 2026-03-17
**GPU Server:** RTX 4000 SFF Ada (20GB), driver 575.57.08, CUDA 12.9

## Model Selection

| Model | Voice Cloning | Stop Behavior | TTFB (stream) | RTF | Verdict |
|-------|--------------|---------------|---------------|-----|---------|
| `0.6B-CustomVoice` | Built-in only (vivian, aiden...) | Correct | 1.5s | 0.78x | Works but no custom voices |
| `0.6B-Base` + `ref_audio` (ICL) | Yes | **Broken — never stops** | N/A | N/A | Unusable |
| `0.6B-Base` + `x_vector_only_mode` | Yes | Correct | 2.0s | 0.98x | **Production choice** |
| `1.7B-Base` | Yes | Same infinite issue | N/A | N/A | Too slow on this GPU anyway |

**Winner:** `Qwen/Qwen3-TTS-12Hz-0.6B-Base` with `x_vector_only_mode: true`.

## How x_vector_only_mode Works

The `Base` model supports two voice cloning modes:

1. **ICL (in-context learning)** — default. Encodes ref_audio as codec tokens and prepends to prompt. The model continues generating in the same codec space with no clear boundary between reference and output → **never hits stop token**.

2. **x_vector_only_mode** — extracts a speaker embedding (x-vector) from ref_audio and conditions generation via the speaker encoder. No codec tokens in the prompt → clean prompt → **proper stop token behavior**.

API usage:
```json
{
  "input": "Text to speak",
  "task_type": "Base",
  "ref_audio": "data:audio/wav;base64,...",
  "ref_text": "Transcript of reference audio",
  "x_vector_only_mode": true,
  "stream": true,
  "response_format": "pcm"
}
```

## NVIDIA Driver Compatibility

**CUDA 13.x drivers are incompatible with PyTorch built against CUDA 12.9.**

| Driver | CUDA Version | PyTorch 2.5.1+cu124 | PyTorch 2.9.1+cu129 |
|--------|-------------|---------------------|---------------------|
| 590.48 (original) | 13.1 | Works | **Fails** (error 803) |
| 595.45 (upgraded) | 13.2 | Works | **Fails** (error 803) |
| 575.57 (installed) | 12.9 | Works | **Works** |

- `VLLM_ENABLE_CUDA_COMPATIBILITY=1` did NOT fix the issue
- `NVIDIA_DISABLE_REQUIRE=1` did NOT fix the issue
- `LD_PRELOAD` with compat libs did NOT fix the issue
- Only installing driver 575 (matching CUDA 12.9) resolved it
- Existing services (Kyutai STT, qwen3-tts fork) use PyTorch 2.5.1+cu124 and work on all three driver versions

**Lesson:** When the vLLM-Omni Docker image is built against CUDA 12.x, the host must run a CUDA 12.x-era driver. The `nvidia-driver-575` package from Ubuntu apt provides this.

Installation:
```bash
sudo apt install nvidia-driver-575=575.57.08-0ubuntu1
sudo reboot
sudo modprobe nvidia  # if module doesn't auto-load
```

## Performance on RTX 4000 SFF Ada

This is a 70W workstation card — expect ~1x real-time generation.

| Metric | x_vector_only_mode | CustomVoice (vivian) |
|--------|-------------------|---------------------|
| TTFB (cold) | 4.6s | ~3s |
| TTFB (warm) | 2.0s | 1.5s |
| RTF | 0.98x | 0.78x |
| Audio quality | Clone of ref voice | High-quality built-in |

- Stage 0 (AR Code Predictor): ~13 tokens/s with CUDA Graphs
- Stage 1 (Code2Wav): runs in eager mode (CUDA Graphs not supported for decoder)
- `gpu_memory_utilization`: Stage 0 = 0.3, Stage 1 = 0.2 (conservative)
- Total VRAM: ~7.5GB (fits alongside 3GB STT = 10.5GB / 20GB)

## Stage Config Tuning Levers

From `qwen3_tts.yaml`:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `codec_chunk_frames` | 25 | Frames per streaming chunk. Lower = lower TTFB but more overhead |
| `codec_left_context_frames` | 25 | Context overlap for smooth chunk boundaries |
| `connector_get_sleep_s` | 0.01 | Polling interval between stages |
| `gpu_memory_utilization` (Stage 0) | 0.3 | AR model memory allocation |
| `gpu_memory_utilization` (Stage 1) | 0.2 | Decoder memory allocation |
| `enforce_eager` (Stage 0) | false | CUDA Graphs enabled |
| `enforce_eager` (Stage 1) | true | Eager mode (decoder can't use graphs) |
| `temperature` (Stage 0) | 0.9 | AR sampling temperature |
| `repetition_penalty` | 1.05 | Prevents token repetition loops |

## ref_audio Format

- `file://` paths are **NOT supported** — returns error
- HTTP/HTTPS URLs — supported
- `data:audio/wav;base64,...` — supported but adds ~924KB per request
- The 924KB overhead adds ~0.5s latency per request on this network

**Future optimization:** Pre-compute speaker embeddings server-side and cache them, eliminating the base64 transfer on every request.

## Voice Registration

`CustomVoice` model has built-in voices from model config (`talker_config.spk_id`):
aiden, dylan, eric, ono_anna, ryan, serena, sohee, uncle_fu, vivian

There is **no API to register new voices** at runtime. Custom voices require either:
1. `Base` model + `ref_audio` + `x_vector_only_mode` (our approach)
2. Fine-tuning a `CustomVoice` model with new speaker data

## Docker Compose

```yaml
services:
  vllm-omni-tts:
    image: vllm/vllm-omni:v0.16.0
    ports:
      - "8091:8091"
    volumes:
      - hf-cache:/root/.cache/huggingface
      - ../qwen3-tts/voices:/app/voices
    ipc: host
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility
      - VLLM_ENABLE_CUDA_COMPATIBILITY=1
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    command: >
      --model Qwen/Qwen3-TTS-12Hz-0.6B-Base
      --stage-configs-path vllm_omni/model_executor/stage_configs/qwen3_tts.yaml
      --omni --port 8091 --trust-remote-code
    restart: unless-stopped
```

## Kit Integration

Provider in `packages/server/src/ttsProviders.ts`:
- `synthesizeWithVllmOmni()` — sends `task_type: Base`, `x_vector_only_mode: true`, `ref_audio` as base64
- `rawPcm: true` flag — tells `streamTtsAudio` to skip WAV header stripping
- Env vars: `VLLM_OMNI_URL`, `TTS_REF_AUDIO` (base64 data URL), `TTS_REF_TEXT`

## Open Issues

1. **TTFB 2s** is higher than the fork's 400ms — acceptable for now, could improve with smaller `codec_chunk_frames`
2. **924KB base64 per request** — should pre-compute and cache x-vectors server-side
3. **No CUDA Graphs on Stage 1** (Code2Wav decoder) — upstream limitation
4. **Cold start ~90s** — model load + CUDA graph compilation on first start
