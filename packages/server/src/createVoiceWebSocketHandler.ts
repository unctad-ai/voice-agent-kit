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


// Read kit version once at module load
let kitVersion = 'unknown';
try {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  kitVersion = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
} catch { /* fallback to 'unknown' */ }

export function createVoiceWebSocketHandler(server: HttpServer, options: VoiceServerOptions): void {
  const wss = new WebSocketServer({ server, path: '/api/voice' });
  console.log(`[voice-agent-kit] v${kitVersion} — WebSocket handler at /api/voice`);

  wss.on('connection', (ws) => {
    const sessionId = randomUUID();

    // Build STT WebSocket URL from options
    const sttBaseUrl = options.kyutaiSttUrl || 'http://localhost:8003';
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
        console.log(`[WS] STT connected for session ${sessionId}`);
      },
      onDisconnected: () => {
        console.log(`[WS] STT disconnected for session ${sessionId}`);
      },
      onError: (err) => {
        console.error(`[WS] STT error for session ${sessionId}:`, err.message);
        safeSend(createEvent('error', { code: 'stt_error', message: err.message }));
      },
    });

    // Build TTS config from options
    const ttsConfig: TtsProviderConfig = {
      ttsProvider: options.ttsProvider || 'qwen3-tts',
      vllmOmniUrl: options.vllmOmniUrl || 'http://localhost:8091',
      vllmOmniRefAudio: options.vllmOmniRefAudio || '',
      vllmOmniRefText: options.vllmOmniRefText || '',
      qwen3TtsUrl: options.qwen3TtsUrl || 'http://localhost:8005',
      chatterboxTurboUrl: options.chatterboxTurboUrl || 'http://localhost:8004',
      cosyVoiceTtsUrl: options.cosyVoiceTtsUrl || 'http://localhost:8004',
      pocketTtsUrl: options.pocketTtsUrl || 'http://pocket-tts:8002',
      resembleApiKey: options.resembleApiKey || '',
      resembleModel: options.resembleModel || '',
      resembleVoiceUuid: options.resembleVoiceUuid || '',
      ttsFallback: options.ttsFallback ?? false,
    };

    pipeline = new VoicePipeline({
      sttClient,
      ttsConfig,
      groqApiKey: options.groqApiKey,
      groqModel: options.groqModel,
      send: safeSend,
      sendBinary: safeSendBinary,
      siteConfig: options.config,
    });

    sttClient.connect();

    safeSend(createEvent('session.created', { session_id: sessionId }));

    let msgCount = 0;
    let audioFrameCount = 0;

    // Audio capture for diagnostics (enabled via CAPTURE_AUDIO=1)
    const captureAudio = process.env.CAPTURE_AUDIO === '1';
    const capturedFrames: Buffer[] = [];

    ws.on('message', (data, isBinary) => {
      msgCount++;
      if (msgCount <= 3 || msgCount % 100 === 0) {
        console.log(`[WS] msg #${msgCount} isBinary=${isBinary} size=${Buffer.isBuffer(data) ? data.length : (data as any).byteLength || 0}`);
      }
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (isAudioFrame(buf)) {
          audioFrameCount++;
          // Always forward audio to STT — it needs continuous audio to produce
          // results on flush. Turn boundary is enforced client-side (useVoiceAgent
          // stops sending audio during PROCESSING/AI_SPEAKING states).
          // Copy to aligned buffer — ws may deliver Buffers with non-4-byte-aligned byteOffset
          const aligned = buf.byteOffset % 4 === 0 ? buf : Buffer.from(buf);
          const pcm = new Float32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
          sttClient.sendAudio(pcm);
          if (captureAudio) capturedFrames.push(Buffer.from(aligned));
          if (audioFrameCount <= 3 || audioFrameCount % 50 === 0) {
            console.log(`[WS] audio frame #${audioFrameCount} samples=${pcm.length} sttConnected=${sttClient.isConnected}`);
          }
        }
        return;
      }

      const event = parseEvent(data.toString());
      if (!event) return;
      console.log(`[WS] event: ${event.type}`);

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
                console.error('[WS] startTurn error:', err);
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
                  console.error('[WS] startTextTurn error:', err);
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
      console.error(`[WS] Connection error for session ${sessionId}:`, err);
    });

    ws.on('close', () => {
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
          console.log(`[WS] Captured ${capturedFrames.length} frames → /tmp/audio-capture/${sessionId}.wav`);
        } catch (e) { console.error('[WS] Audio capture write failed:', e); }
      }
      console.log(`[WS] Session ${sessionId} closed`);
    });
  });
}
