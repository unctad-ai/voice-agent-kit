# Migrate TTS to vLLM-Omni

## Context

We run a voice assistant pipeline: Browser → WebSocket → Node.js server → STT (Kyutai/Moshi) → LLM (Groq) → TTS (Qwen3-TTS) → audio back to browser.

The TTS server is a custom FastAPI app using the [rekuenkdr/Qwen3-TTS-streaming](https://github.com/rekuenkdr/Qwen3-TTS-streaming) fork. It works but has a fundamental deadlock problem: the Python generator holds a GPU lock inside a CUDA kernel. When clients disconnect mid-stream, the lock is never released. We have a watchdog band-aid (45s auto-release) but the proper fix is architectural.

[vLLM-Omni](https://github.com/vllm-project/vllm-omni) is a production TTS serving engine that handles this natively via disaggregated pipeline + CUDA Graphs. It supports Qwen3-TTS with voice cloning and OpenAI-compatible API.

## Goal

Replace our custom FastAPI TTS server with vLLM-Omni on the same GPU server. Keep the STT server (Kyutai) running alongside it.

## GPU Server Specs

- **Host**: `5.9.49.171` (accessible via `ssh gpu-server`)
- **GPU**: NVIDIA RTX 4000 SFF Ada Generation, 20GB VRAM, compute capability 8.9
- **CPU**: Intel i5-13500, 20 cores
- **RAM**: 62GB
- **Disk**: 1.7TB (1.2TB free)
- **OS**: Ubuntu 24.04, kernel 6.8
- **Docker**: 29.1.5
- **CUDA driver**: 590.48 (CUDA 13.1)
- **Current VRAM usage**: STT ~3GB, TTS ~4.5GB = ~7.6GB used, ~12GB free

## Current TTS Setup

- **Location**: `/home/mehdi/qwen3-tts/` on GPU server
- **Model**: `Qwen3-TTS-12Hz-1.7B-Base` via rekuenkdr streaming fork
- **Docker**: `docker-compose.yml` with PyTorch 2.5.1 + CUDA 12.4 base
- **Port**: 8005
- **Voice cloning**: ICL mode with reference audio file + transcript stored in `voices/` directory
- **Endpoints**:
  - `POST /tts` — single-shot (non-streaming), returns complete WAV
  - `POST /tts-pipeline` — token-level streaming, returns chunked WAV (PCM Int16, 24kHz)
  - `GET /health` — health check
- **Protocol**: `application/x-www-form-urlencoded` with fields: `text`, `temperature`
- **Response**: WAV file (44-byte header + PCM Int16 mono 24kHz)
- **Performance**: TTFA ~400ms, RTF ~0.87

## Target: vLLM-Omni

### Installation

```bash
docker run --runtime nvidia --gpus 1 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -p 8091:8091 --ipc=host \
  vllm/vllm-omni:v0.16.0 \
  --model Qwen/Qwen3-TTS-12Hz-1.7B-Base \
  --stage-configs-path vllm_omni/model_executor/stage_configs/qwen3_tts.yaml \
  --omni --port 8091 --trust-remote-code --enforce-eager
```

### API

OpenAI-compatible `POST /v1/audio/speech`:

```json
{
  "input": "Hello, how can I help you today?",
  "task_type": "Base",
  "ref_audio": "file:///app/voices/pesa/voice.wav",
  "ref_text": "Transcript of the reference audio for ICL alignment",
  "stream": true,
  "response_format": "pcm"
}
```

Response: streaming PCM Int16 24kHz (same as our current format, but NO WAV header).

WebSocket alternative: `ws://host:8091/v1/audio/speech/stream`

### Voice Cloning

Same ICL mode we use today. Pass `ref_audio` (URL, base64, or `file://` path) + `ref_text` (transcript). The reference audio files are currently in `/home/mehdi/qwen3-tts/voices/` — mount this directory into the vLLM-Omni container.

### Expected Performance

- **TTFA**: ~150-200ms (vs current ~400ms) — CUDA Graph acceleration
- **RTF**: ~0.80-0.95 (comparable to current)
- **VRAM**: ~6-8GB (fits alongside 3GB STT on 20GB GPU)
- **Concurrency**: Native batching, no GPU lock needed

### Key Differences from Current

| Aspect | Current (custom FastAPI) | vLLM-Omni |
|--------|------------------------|-----------|
| API format | form-urlencoded | JSON |
| Endpoint | `/tts-pipeline` | `/v1/audio/speech` |
| WAV header | Included in stream | Not included (raw PCM when `response_format=pcm`) |
| Voice selection | `voice` form field (voice ID) | `ref_audio` + `ref_text` fields |
| Temperature | `temperature` form field | Not yet supported (P1 roadmap) |
| Health check | `GET /health` | `GET /health` (standard vLLM) |
| GPU lock | Manual `threading.Lock` + watchdog | Not needed (native batching) |

## Implementation Plan

### Phase 1: Deploy vLLM-Omni alongside current TTS

1. **Create docker-compose for vLLM-Omni** at `/home/mehdi/vllm-omni-tts/docker-compose.yml`
   - Use `vllm/vllm-omni:v0.16.0` image
   - Port 8091 (don't conflict with current TTS on 8005)
   - Mount the voices directory: `-v /home/mehdi/qwen3-tts/voices:/app/voices`
   - Mount HuggingFace cache: `-v /root/.cache/huggingface:/root/.cache/huggingface`

2. **Verify voice cloning works** by sending a test request:
   ```bash
   curl -X POST http://5.9.49.171:8091/v1/audio/speech \
     -H "Content-Type: application/json" \
     -d '{"input":"Hello, I am Pesa.","task_type":"Base","ref_audio":"file:///app/voices/pesa/voice.wav","ref_text":"...","stream":false,"response_format":"wav"}' \
     -o test.wav
   ```

3. **Benchmark** TTFA and RTF against current TTS using the same test sentences.

### Phase 2: Add vLLM-Omni provider to voice-agent-kit

4. **Add `synthesizeWithVllmOmni()` function** in `packages/server/src/ttsProviders.ts`:
   ```typescript
   async function synthesizeWithVllmOmni(
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

5. **Update `synthesize()` router** to support `ttsProvider: 'vllm-omni'`.

6. **Update `streamTtsAudio()` in voicePipeline.ts** — vLLM-Omni with `response_format: pcm` returns raw PCM (no WAV header). The current code strips a 44-byte WAV header from the first chunk. When using vLLM-Omni, skip the header stripping.

7. **Add env vars**:
   ```
   TTS_PROVIDER=vllm-omni
   VLLM_OMNI_URL=http://5.9.49.171:8091
   TTS_REF_AUDIO=file:///app/voices/pesa/voice.wav
   TTS_REF_TEXT=<transcript of reference audio>
   ```

### Phase 3: Validate and switch

8. **Run the full pipeline eval** (`scripts/test-pipeline.mjs`) against both providers with the same queries.

9. **Compare**: TTFA, RTF, audio quality (same text, same voice, A/B listen test).

10. **If vLLM-Omni wins**: update production env vars to `TTS_PROVIDER=vllm-omni`, remove old TTS container.

11. **If not**: keep current setup with the background thread deadlock fix.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Temperature not supported yet | Less expressive voice | Use `instructions` field for style, or wait for P1 |
| Voice upload API still WIP | Can't upload new voices via API | Use file:// paths mounted in container |
| Model download on first start | Slow cold start (~5min) | Pre-pull model in Docker build or mount cache |
| VRAM pressure with STT + TTS | OOM | Monitor with `nvidia-smi`; STT (3GB) + vLLM (8GB) = 11GB < 20GB |
| vLLM-Omni bugs | TTS failures | Keep current TTS container running as fallback on port 8005 |

## Files to Modify

| File | Change |
|------|--------|
| `gpu-services/vllm-omni-tts/docker-compose.yml` | **New** — vLLM-Omni deployment |
| `packages/server/src/ttsProviders.ts` | Add `synthesizeWithVllmOmni()`, update router |
| `packages/server/src/voicePipeline.ts` | Skip WAV header for raw PCM providers |
| `packages/server/src/types.ts` | Add vLLM-Omni config fields |
| Consuming project `.env` files | Add `TTS_PROVIDER`, `VLLM_OMNI_URL`, `TTS_REF_AUDIO`, `TTS_REF_TEXT` |

## References

- [vLLM-Omni Docs](https://docs.vllm.ai/projects/vllm-omni/en/latest/)
- [Qwen3-TTS Serving Examples](https://docs.vllm.ai/projects/vllm-omni/en/latest/user_guide/examples/online_serving/qwen3_tts/)
- [Speech API Reference](https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/speech_api/)
- [Production-Ready RFC #938](https://github.com/vllm-project/vllm-omni/issues/938)
- [Docker Deployment Guide](https://deepwiki.com/vllm-project/vllm-omni/2.2-docker-deployment)
- [Qwen3-TTS Technical Report](https://arxiv.org/html/2601.15621v1)
