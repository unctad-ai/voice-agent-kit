#!/usr/bin/env node
/**
 * Isolated TTS evaluation.
 *
 * Tests the qwen3-tts GPU service directly — no pipeline, no Express, no WebSocket.
 * Measures TTFA, total latency, audio quality, and GPU lock recovery.
 *
 * Usage:
 *   node scripts/test-tts.mjs [tts-url]
 *   node scripts/test-tts.mjs http://5.9.49.171:8005
 *
 * Endpoints tested:
 *   /health           — service status
 *   /tts              — non-streaming (full waveform)
 *   /tts-pipeline     — streaming (token-level, TTFA ~200ms)
 */

const TTS_URL = process.argv[2] || process.env.QWEN3_TTS_URL || 'http://5.9.49.171:8005';

const TEST_TEXTS = [
  { text: 'Hello, how can I help you today?', label: 'short' },
  { text: 'Kenya Trade Single Window provides services across many areas such as company registration, tax registration, and investment permits.', label: 'medium' },
  { text: 'To register a company in Kenya, you need to prepare your identification documents, choose a unique company name, and submit the application through the eCitizen portal. The process typically takes three to five business days.', label: 'long' },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function parseWavHeader(buf) {
  if (buf.length < 44) return null;
  const riff = buf.toString('ascii', 0, 4);
  if (riff !== 'RIFF') return null;
  return {
    format: buf.readUInt16LE(20) === 1 ? 'PCM-Int16' : buf.readUInt16LE(20) === 3 ? 'PCM-Float32' : `unknown(${buf.readUInt16LE(20)})`,
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bitsPerSample: buf.readUInt16LE(34),
    dataSize: buf.readUInt32LE(40),
  };
}

function durationFromBytes(dataSize, sampleRate, channels, bitsPerSample) {
  const bytesPerSample = (bitsPerSample / 8) * channels;
  return dataSize / (sampleRate * bytesPerSample);
}

// ─── Tests ───────────────────────────────────────────────────────────

async function testHealth() {
  process.stdout.write('  Health check... ');
  try {
    const res = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.status === 'ok') {
      console.log(`OK (${data.model}, ${data.clone_mode}, ${data.sample_rate}Hz, VRAM ${data.vram_gb}GB)`);
      return { pass: true, data };
    }
    console.log(`FAIL: status=${data.status}`);
    return { pass: false };
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    return { pass: false };
  }
}

async function testEndpoint(endpoint, text, label) {
  process.stdout.write(`  ${endpoint} [${label}]... `);
  const body = new URLSearchParams({ text, temperature: '0.3' });
  const t0 = performance.now();
  let ttfaMs = 0;
  let totalBytes = 0;
  let firstChunk = null;
  let chunks = 0;

  try {
    const res = await fetch(`${TTS_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.log(`FAIL: HTTP ${res.status} — ${errBody.slice(0, 100)}`);
      return { pass: false, status: res.status, error: errBody };
    }

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      totalBytes += value.length;
      if (!firstChunk) {
        ttfaMs = Math.round(performance.now() - t0);
        firstChunk = Buffer.from(value);
      }
    }

    const totalMs = Math.round(performance.now() - t0);
    const wav = parseWavHeader(firstChunk);

    if (!wav) {
      console.log(`FAIL: Invalid WAV header (${totalBytes} bytes, ${chunks} chunks)`);
      return { pass: false, totalBytes, chunks };
    }

    const audioDuration = durationFromBytes(totalBytes - 44, wav.sampleRate, wav.channels, wav.bitsPerSample);

    console.log(
      `OK  TTFA=${ttfaMs}ms  total=${totalMs}ms  audio=${audioDuration.toFixed(1)}s  ` +
      `${wav.format} ${wav.sampleRate}Hz ${wav.channels}ch  ${chunks} chunks ${(totalBytes / 1024).toFixed(0)}KB`
    );

    return {
      pass: true,
      ttfaMs,
      totalMs,
      audioDuration,
      format: wav.format,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitsPerSample: wav.bitsPerSample,
      chunks,
      totalBytes,
    };
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    return { pass: false, error: err.message };
  }
}

async function testCancelRecovery() {
  process.stdout.write('  Cancel recovery... ');
  const body = new URLSearchParams({
    text: 'This is a longer sentence to test what happens when the client disconnects mid stream during generation.',
    temperature: '0.3',
  });

  // Start a request and abort after 500ms
  const controller = new AbortController();
  try {
    const res = await fetch(`${TTS_URL}/tts-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    // Read a few chunks then abort
    const reader = res.body.getReader();
    const { value } = await reader.read();
    controller.abort();
    reader.cancel().catch(() => {});
  } catch {
    // Expected — abort throws
  }

  // Wait for watchdog / lock recovery
  process.stdout.write('(waiting 3s) ');
  await new Promise(r => setTimeout(r, 3000));

  // Try a new request — should work if lock recovered
  const res2 = await testEndpoint('/tts', 'Recovery test.', 'post-cancel');
  if (res2.pass) {
    console.log('  Cancel recovery: PASS — GPU lock recovered');
  } else {
    console.log('  Cancel recovery: FAIL — GPU lock stuck (watchdog not triggered yet?)');
  }
  return res2;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`TTS URL: ${TTS_URL}\n`);

  // Health
  const health = await testHealth();
  if (!health.pass) {
    console.log('\nTTS service not available. Exiting.');
    process.exit(1);
  }

  console.log('\n── Non-streaming /tts ──');
  const ttsResults = [];
  for (const { text, label } of TEST_TEXTS) {
    const r = await testEndpoint('/tts', text, label);
    ttsResults.push({ ...r, label, endpoint: '/tts' });
  }

  console.log('\n── Streaming /tts-pipeline ──');
  const pipelineResults = [];
  for (const { text, label } of TEST_TEXTS) {
    const r = await testEndpoint('/tts-pipeline', text, label);
    pipelineResults.push({ ...r, label, endpoint: '/tts-pipeline' });
  }

  console.log('\n── Cancel + Recovery ──');
  await testCancelRecovery();

  // Summary
  console.log('\n═══ SUMMARY ═══');
  const all = [...ttsResults, ...pipelineResults].filter(r => r.pass);
  if (all.length === 0) {
    console.log('All tests failed.');
    process.exit(1);
  }

  const avgTtfa = Math.round(all.reduce((s, r) => s + r.ttfaMs, 0) / all.length);
  const avgTotal = Math.round(all.reduce((s, r) => s + r.totalMs, 0) / all.length);
  const ttsAvg = ttsResults.filter(r => r.pass);
  const pipeAvg = pipelineResults.filter(r => r.pass);

  console.log(`  Passed: ${all.length}/${ttsResults.length + pipelineResults.length}`);
  console.log(`  Avg TTFA:  /tts=${ttsAvg.length ? Math.round(ttsAvg.reduce((s, r) => s + r.ttfaMs, 0) / ttsAvg.length) : 'N/A'}ms  /tts-pipeline=${pipeAvg.length ? Math.round(pipeAvg.reduce((s, r) => s + r.ttfaMs, 0) / pipeAvg.length) : 'N/A'}ms`);
  console.log(`  Avg total: /tts=${ttsAvg.length ? Math.round(ttsAvg.reduce((s, r) => s + r.totalMs, 0) / ttsAvg.length) : 'N/A'}ms  /tts-pipeline=${pipeAvg.length ? Math.round(pipeAvg.reduce((s, r) => s + r.totalMs, 0) / pipeAvg.length) : 'N/A'}ms`);
  console.log(`  Format: ${all[0]?.format} ${all[0]?.sampleRate}Hz ${all[0]?.bitsPerSample}bit`);

  process.exit(all.length === ttsResults.length + pipelineResults.length ? 0 : 1);
}

main().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
