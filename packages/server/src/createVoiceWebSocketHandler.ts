import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { randomUUID } from 'node:crypto';
import { parseEvent, createEvent, isAudioFrame } from './protocol.js';
import { VoicePipeline } from './voicePipeline.js';
import { SttStreamClient } from './sttStreamClient.js';
import type { VoiceServerOptions } from './types.js';

export function createVoiceWebSocketHandler(server: HttpServer, options: VoiceServerOptions): void {
  const wss = new WebSocketServer({ server, path: '/api/voice' });

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
    const ttsConfig = {
      ttsProvider: options.ttsProvider || 'qwen3-tts',
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
    ws.on('message', (data, isBinary) => {
      msgCount++;
      if (msgCount <= 3 || msgCount % 100 === 0) {
        console.log(`[WS] msg #${msgCount} isBinary=${isBinary} size=${Buffer.isBuffer(data) ? data.length : (data as any).byteLength || 0}`);
      }
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (isAudioFrame(buf)) {
          audioFrameCount++;
          const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
          sttClient.sendAudio(pcm);
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
          sttClient.flush();
          pipeline.startTurn();
          break;
        case 'input_audio_buffer.clear':
          sttClient.reset();
          break;
        case 'response.cancel':
          pipeline.cancel();
          sttClient.reset();
          break;
        case 'tool.result':
          pipeline.resolveToolCall(event.tool_call_id, event.result);
          break;
      }
    });

    ws.on('close', () => {
      pipeline.cancel();
      sttClient.close();
      console.log(`[WS] Session ${sessionId} closed`);
    });
  });
}
