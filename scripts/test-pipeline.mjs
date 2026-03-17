#!/usr/bin/env node
/**
 * Headless pipeline eval — tests LLM + tool calling + TTS through the WebSocket
 * without a browser or audio input. Uses text.submit to bypass STT.
 *
 * Usage:
 *   node scripts/test-pipeline.mjs [ws-url]
 *   node scripts/test-pipeline.mjs ws://localhost:3001/api/voice
 *
 * Requires: backend running with attachVoicePipeline on the target URL.
 */

// Use native WebSocket if available (Node 22+), fall back to ws package
const WebSocket = globalThis.WebSocket ?? (await import('ws')).default;

const WS_URL = process.argv[2] || 'ws://localhost:3001/api/voice';

// ─── Test cases ──────────────────────────────────────────────────────

const TESTS = [
  {
    query: 'What services are available?',
    expectToolCall: false,
    expectSilent: false,
    label: 'general question',
  },
  {
    query: 'Take me to the home page',
    expectToolCall: true,
    expectToolName: 'navigateTo',
    expectSilent: false,
    label: 'navigation',
  },
  {
    query: 'Search for tax registration',
    expectToolCall: true,
    expectToolName: 'searchServices',
    expectSilent: false,
    label: 'search',
  },
  {
    query: 'What investor services are available?',
    expectToolCall: true,
    expectToolName: 'listServicesByCategory',
    expectSilent: false,
    label: 'category browse',
  },
  {
    query: 'hmm yeah okay',
    expectToolCall: false,
    expectSilent: true,
    label: 'filler — should be [SILENT]',
  },
  {
    query: 'Thank you for your help',
    expectToolCall: false,
    expectSilent: false,
    label: 'polite — should respond',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Connection timeout')); }, 10000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.addEventListener('error', (err) => { clearTimeout(timeout); reject(new Error('WebSocket error')); });
  });
}

function runQuery(ws, text) {
  return new Promise((resolve) => {
    const result = {
      text: '',
      toolCalls: [],
      audioBytes: 0,
      timings: null,
      error: null,
      events: [],
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(result);
    }, 30000);

    function cleanup() {
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
    }

    function handler(ev) {
      // Native WebSocket: binary arrives as Blob or ArrayBuffer
      if (ev.data instanceof ArrayBuffer || (typeof Blob !== 'undefined' && ev.data instanceof Blob)) {
        result.audioBytes += ev.data.size || ev.data.byteLength || 0;
        return;
      }
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let event;
      try { event = JSON.parse(raw); } catch { return; }
      result.events.push(event.type);

      if (event.type === 'response.text.delta') {
        result.text += event.delta || '';
      }
      if (event.type === 'response.text.done') {
        result.text = event.text || result.text;
      }
      if (event.type === 'tool.call') {
        result.toolCalls.push({ name: event.name, args: event.arguments });
        // Auto-respond to tool calls with mock data
        ws.send(JSON.stringify({
          type: 'tool.result',
          tool_call_id: event.tool_call_id,
          result: mockToolResult(event.name),
        }));
      }
      if (event.type === 'timings') {
        result.timings = event;
      }
      if (event.type === 'error') {
        result.error = event.message;
      }
      // Turn complete when status goes back to listening
      if (event.type === 'status' && event.status === 'listening' && result.events.length > 2) {
        cleanup();
        resolve(result);
      }
    }

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ type: 'text.submit', text }));
  });
}

function mockToolResult(name) {
  switch (name) {
    case 'searchServices':
      return { totalResults: 2, services: [
        { id: 'tax-reg', title: 'Tax Registration PIN', category: 'permits' },
        { id: 'vat-reg', title: 'VAT Registration', category: 'permits' },
      ]};
    case 'navigateTo':
      return { success: true, url: '/' };
    case 'viewService':
      return { success: true, url: '/service/tax-reg' };
    case 'getServiceDetails':
      return { title: 'Tax Registration PIN', category: 'permits', duration: '3-5 days', cost: 'Free', requirements: ['ID', 'KRA PIN'] };
    case 'listServicesByCategory':
      return { category: 'investor', services: [
        { id: 'inv-reg', title: 'Investor Registration' },
        { id: 'inv-cert', title: 'Investment Certificate' },
      ]};
    default:
      return { success: true };
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`Pipeline URL: ${WS_URL}\n`);

  let ws;
  try {
    ws = await connectWs();
  } catch (err) {
    console.error(`Failed to connect: ${err.message}`);
    console.error('Is the backend running?');
    process.exit(1);
  }

  // Wait for session.created
  await new Promise((resolve) => {
    ws.addEventListener('message', function handler(ev) {
      const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
      const event = JSON.parse(raw);
      if (event.type === 'session.created') {
        console.log(`Connected: session=${event.session_id}\n`);
      }
      ws.removeEventListener('message', handler);
      resolve();
    });
  });

  // Send session.update
  ws.send(JSON.stringify({
    type: 'session.update',
    conversation: [],
  }));
  await sleep(500);

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const test of TESTS) {
    process.stdout.write(`  ${test.label}: "${test.query}" ... `);

    const t0 = performance.now();
    const result = await runQuery(ws, test.query);
    const elapsed = Math.round(performance.now() - t0);

    const isSilent = result.text.includes('[SILENT]') || (!result.text.trim() && result.toolCalls.length === 0);
    const hasToolCall = result.toolCalls.length > 0;
    const toolNames = result.toolCalls.map(t => t.name);

    let pass = true;
    const issues = [];

    // Check expectations
    if (test.expectSilent && !isSilent) {
      issues.push(`expected SILENT, got "${result.text.slice(0, 50)}"`);
      pass = false;
    }
    if (!test.expectSilent && isSilent) {
      issues.push('expected response, got SILENT');
      pass = false;
    }
    if (test.expectToolCall && !hasToolCall) {
      issues.push(`expected tool call (${test.expectToolName}), got none`);
      pass = false;
    }
    if (test.expectToolName && !toolNames.includes(test.expectToolName)) {
      issues.push(`expected ${test.expectToolName}, got ${toolNames.join(',') || 'none'}`);
      pass = false;
    }
    if (result.error) {
      issues.push(`error: ${result.error}`);
      pass = false;
    }

    if (pass) {
      passed++;
      const detail = hasToolCall ? `tools=[${toolNames.join(',')}]` : `"${result.text.slice(0, 60)}"`;
      console.log(`PASS (${elapsed}ms) ${detail}${result.audioBytes > 0 ? ` +${(result.audioBytes/1024).toFixed(0)}KB audio` : ''}`);
    } else {
      failed++;
      console.log(`FAIL (${elapsed}ms) ${issues.join('; ')}`);
    }

    results.push({ ...test, pass, elapsed, toolNames, text: result.text, audioBytes: result.audioBytes, error: result.error });
    await sleep(500); // Rate limit between queries
  }

  ws.close();

  // Summary
  console.log(`\n═══ SUMMARY ═══`);
  console.log(`  ${passed}/${TESTS.length} passed, ${failed} failed`);

  const timings = results.filter(r => r.pass && r.elapsed > 0);
  if (timings.length > 0) {
    const avgMs = Math.round(timings.reduce((s, r) => s + r.elapsed, 0) / timings.length);
    console.log(`  Avg response time: ${avgMs}ms`);
  }

  const withAudio = results.filter(r => r.audioBytes > 0);
  if (withAudio.length > 0) {
    console.log(`  Turns with TTS audio: ${withAudio.length}/${results.filter(r => !r.pass || !results.find(t => t === r)?.expectSilent).length}`);
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
