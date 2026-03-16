#!/usr/bin/env node
/**
 * Send a captured .f32 audio file directly to the STT server.
 * Compares pipeline-captured audio against direct STT to isolate quality issues.
 *
 * Usage:
 *   node scripts/test-stt-capture.mjs <file.f32> [stt-url]
 *
 * The .f32 file is raw Float32 PCM at 24kHz (captured by CAPTURE_AUDIO=1).
 */

import { readFileSync } from 'fs';
import WebSocket from 'ws';

const file = process.argv[2];
const sttUrl = process.argv[3] || 'ws://5.9.49.171:8003/ws/transcribe';

if (!file) {
  console.error('Usage: node scripts/test-stt-capture.mjs <file.f32> [stt-url]');
  process.exit(1);
}

const raw = readFileSync(file);
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const FRAME_SIZE = 1920; // 80ms at 24kHz
const totalFrames = Math.floor(pcm.length / FRAME_SIZE);

console.log(`Audio: ${(pcm.length / 24000).toFixed(1)}s, ${totalFrames} frames`);
console.log(`Connecting to ${sttUrl}...`);

const ws = new WebSocket(sttUrl);

ws.on('open', () => {
  console.log('Connected. Sending frames...');

  // Send frames at ~80ms intervals (real-time)
  let i = 0;
  const interval = setInterval(() => {
    if (i >= totalFrames) {
      clearInterval(interval);
      console.log(`All ${totalFrames} frames sent. Sending flush...`);
      ws.send(JSON.stringify({ type: 'flush' }));
      return;
    }
    const frame = pcm.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE);
    ws.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
    i++;
  }, 80);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'word') {
    process.stdout.write(msg.text + ' ');
  } else if (msg.type === 'done') {
    console.log(`\n\nSTT result: "${msg.text}"`);
    console.log(`Duration: ${msg.duration_ms}ms`);
    ws.close();
  } else if (msg.type === 'vad') {
    // skip
  } else {
    console.log('Event:', msg.type, JSON.stringify(msg).slice(0, 100));
  }
});

ws.on('error', (err) => console.error('WS error:', err.message));
ws.on('close', () => { console.log('Done.'); process.exit(0); });

// Timeout
setTimeout(() => { console.error('Timeout after 30s'); process.exit(1); }, 30000);
