import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEvent, createEvent, isAudioFrame } from './protocol.js';
import { VoicePipeline } from './voicePipeline.js';
import { SttStreamClient } from './sttStreamClient.js';
import type { VoiceServerOptions } from './types.js';
import type { TtsProviderConfig } from './ttsProviders.js';
import { createSessionLogger } from './logger.js';


// Read kit version once at module load
let kitVersion = 'unknown';
try {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  kitVersion = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
} catch { /* fallback to 'unknown' */ }

export function createVoiceWebSocketHandler(
  server: HttpServer,
  options: VoiceServerOptions,
): { broadcast: (event: Record<string, unknown>) => void } {
  const wss = new WebSocketServer({ server, path: '/api/voice' });
  console.log(`[voice-agent-kit] v${kitVersion} — WebSocket handler at /api/voice`);

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    const sessionId = randomUUID();
    const logger = createSessionLogger(sessionId);

    // Build STT WebSocket URL from options
    const sttBaseUrl = options.sttUrl || process.env.STT_URL || 'http://localhost:8003';
    const sttWsUrl = sttBaseUrl.replace(/^http/, 'ws') + '/ws/transcribe';

    const safeSend = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    };
    const safeSendBinary = (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
    };

    // Declare pipeline as a let — the STT callbacks reference it via closure.
    // This is safe because callbacks are only invoked asynchronously after the
    // STT WebSocket connects, by which time pipeline is fully initialized.
    let pipeline: VoicePipeline;

    // Create STT client with callbacks that forward to pipeline
    const sttClient = new SttStreamClient(sttWsUrl, {
      onWord: (_text, _tokenId) => {
        // Partial transcript forwarding can be added here for real-time subtitles
      },
      onVad: (_probs) => {
        // VAD events can be forwarded if needed
      },
      onDone: (text, vadProbs, durationMs) => {
        pipeline.resolveSttDone(text, vadProbs, durationMs);
      },
      onConnected: () => {
        logger.info('stt:connected');
      },
      onDisconnected: () => {
        logger.info('stt:disconnected');
      },
      onError: (err) => {
        logger.error('stt:error', err.message);
        safeSend(createEvent('error', { code: 'stt_error', message: err.message }));
      },
    }, logger);

    // Build TTS config from options
    const ttsConfig: TtsProviderConfig = {
      ttsProvider: options.ttsProvider || process.env.TTS_PROVIDER || 'luxtts',
      vllmOmniUrl: options.vllmOmniUrl || process.env.VLLM_OMNI_URL || '',
      vllmOmniRefAudio: options.vllmOmniRefAudio || '',
      vllmOmniRefText: options.vllmOmniRefText || '',
      qwen3TtsUrl: options.qwen3TtsUrl || process.env.QWEN3_TTS_URL || '',
      chatterboxTurboUrl: options.chatterboxTurboUrl || process.env.CHATTERBOX_TURBO_URL || '',
      cosyVoiceTtsUrl: options.cosyVoiceTtsUrl || process.env.COSYVOICE_TTS_URL || '',
      luxTtsUrl: options.luxTtsUrl ?? process.env.LUXTTS_URL ?? '',
      luxTtsSpeed: options.luxTtsSpeed ?? parseFloat(process.env.LUXTTS_SPEED ?? '0.85'),
      luxTtsTShift: options.luxTtsTShift ?? parseFloat(process.env.LUXTTS_T_SHIFT ?? '0.8'),
      pocketTtsUrl: options.pocketTtsUrl || process.env.POCKET_TTS_URL || '',
      resembleApiKey: options.resembleApiKey || '',
      resembleModel: options.resembleModel || '',
      resembleVoiceUuid: options.resembleVoiceUuid || '',
      getActiveVoiceId: options.getActiveVoiceId,
      ttsFallback: options.ttsFallback ?? false,
    };

    pipeline = new VoicePipeline({
      logger,
      sttClient,
      ttsConfig,
      groqApiKey: options.groqApiKey,
      groqModel: options.groqModel,
      send: safeSend,
      sendBinary: safeSendBinary,
      siteConfig: options.config,
      sttHallucinationFilter: options.sttHallucinationFilter ?? (process.env.STT_HALLUCINATION_FILTER !== 'false'),
    });

    sttClient.connect();

    safeSend(createEvent('session.created', { session_id: sessionId }));

    // Audio capture for diagnostics (enabled via CAPTURE_AUDIO=1)
    const captureAudio = process.env.CAPTURE_AUDIO === '1';
    const capturedFrames: Buffer[] = [];

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (isAudioFrame(buf)) {
          const aligned = buf.byteOffset % 4 === 0 ? buf : Buffer.from(buf);
          const pcm = new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
          sttClient.sendAudio(pcm);
          if (captureAudio) capturedFrames.push(Buffer.from(aligned));
        }
        return;
      }

      const event = parseEvent(data.toString());
      if (!event) return;

      switch (event.type) {
        case 'session.update':
          pipeline.setSession(event);
          break;
        case 'input_audio_buffer.commit':
          // Cancel any in-flight turn before starting a new one
          pipeline.cancel();
          sttClient.flush();
          pipeline.startTurn()
            .catch((err) => {
              if (err?.message !== 'cancelled') {
                logger.error('startTurn:error', err);
                safeSend(createEvent('error', { code: 'pipeline_error', message: err?.message || 'Unknown error' }));
                safeSend(createEvent('status', { status: 'listening' }));
              }
            });
          break;
        case 'input_audio_buffer.clear':
          sttClient.reset();
          break;
        case 'response.cancel':
          pipeline.cancel();
          sttClient.reset();
          break;
        case 'text.submit':
          // Text-only turn — bypass STT, go straight to LLM → TTS
          if (event.text) {
            pipeline.startTextTurn(event.text)
              .catch((err) => {
                if (err?.message !== 'cancelled') {
                  logger.error('startTextTurn:error', err);
                  safeSend(createEvent('error', { code: 'pipeline_error', message: err?.message || 'Unknown error' }));
                  safeSend(createEvent('status', { status: 'listening' }));
                }
              });
          }
          break;
        case 'tool.result':
          pipeline.resolveToolCall(event.tool_call_id, event.result);
          break;
      }
    });

    ws.on('error', (err) => {
      clients.delete(ws);
      logger.error('ws:error', err);
    });

    ws.on('close', () => {
      clients.delete(ws);
      pipeline.cancel();
      sttClient.close();
      if (captureAudio && capturedFrames.length > 0) {
        try {
          mkdirSync('/tmp/audio-capture', { recursive: true });
          const raw = Buffer.concat(capturedFrames);
          // Write raw Float32 PCM
          writeFileSync(`/tmp/audio-capture/${sessionId}.f32`, raw);
          // Write WAV header + PCM for easy playback
          const wavHeader = Buffer.alloc(44);
          const dataSize = raw.length;
          const fileSize = 36 + dataSize;
          wavHeader.write('RIFF', 0); wavHeader.writeUInt32LE(fileSize, 4);
          wavHeader.write('WAVE', 8); wavHeader.write('fmt ', 12);
          wavHeader.writeUInt32LE(16, 16); wavHeader.writeUInt16LE(3, 20); // IEEE float
          wavHeader.writeUInt16LE(1, 22); wavHeader.writeUInt32LE(24000, 24);
          wavHeader.writeUInt32LE(24000 * 4, 28); wavHeader.writeUInt16LE(4, 32);
          wavHeader.writeUInt16LE(32, 34); wavHeader.write('data', 36);
          wavHeader.writeUInt32LE(dataSize, 40);
          writeFileSync(`/tmp/audio-capture/${sessionId}.wav`, Buffer.concat([wavHeader, raw]));
          logger.info('audio:captured', `${capturedFrames.length} frames → /tmp/audio-capture/${sessionId}.wav`);
        } catch (e) { logger.error('audio:capture-failed', e); }
      }
      logger.info('session:closed');
    });
  });

  function broadcast(event: Record<string, unknown>) {
    const msg = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  return { broadcast };
}
