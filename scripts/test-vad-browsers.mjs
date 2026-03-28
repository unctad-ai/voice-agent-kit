#!/usr/bin/env node
/**
 * Cross-browser VAD pipeline test using Playwright.
 *
 * Injects a fake audio device (WAV file) into Chrome, Firefox, and WebKit,
 * opens the voice agent panel, and checks whether the VAD detects speech
 * by monitoring console output and server logs.
 *
 * Usage:
 *   npx playwright install chromium firefox webkit   # first time only
 *   node scripts/test-vad-browsers.mjs [base-url]
 *   node scripts/test-vad-browsers.mjs http://localhost:3000
 *
 * Requirements:
 *   - Backend running at the target URL
 *   - A test WAV file at scripts/test-speech.wav (or use --wav=path)
 */

import { chromium, firefox, webkit } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3000';
const WAV_ARG = process.argv.find(a => a.startsWith('--wav='));
const WAV_PATH = WAV_ARG ? WAV_ARG.split('=')[1] : join(__dirname, 'test-speech.wav');
const TEST_PAGE = '/service/tax-registration-pin';
const TIMEOUT_MS = 20_000;

// Generate test WAV if missing (macOS only)
if (!existsSync(WAV_PATH)) {
  console.log('Generating test speech WAV...');
  try {
    execSync(`say --file-format=WAVE --data-format=LEI16@16000 -o "${WAV_PATH}" "Hello, how do I register a company?"`);
  } catch {
    console.error(`No WAV file at ${WAV_PATH} and 'say' command unavailable. Provide --wav=path.`);
    process.exit(1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatResult(name, logs) {
  const wasmLoaded = logs.some(l => l.includes('[VAD] WASM loaded'));
  const wasmFailed = logs.find(l => l.includes('[VAD] WASM FAILED'));
  const micReady = logs.some(l => l.includes('[VAD] mic + worklet ready'));
  const micFailed = logs.find(l => l.includes('[VAD] start FAILED'));
  const firstFrame = logs.some(l => l.includes('[VAD] first frame'));
  const frames100 = logs.some(l => l.includes('[VAD] 100 frames'));

  const pipeline = [
    wasmLoaded ? '✓ WASM' : wasmFailed ? `✗ WASM (${wasmFailed})` : '? WASM',
    micReady ? '✓ mic' : micFailed ? `✗ mic (${micFailed})` : '? mic',
    firstFrame ? '✓ frames' : '✗ frames',
    frames100 ? '✓ 100+' : '✗ <100',
  ];

  const ok = wasmLoaded && micReady && firstFrame && frames100;
  return { name, ok, pipeline, logs };
}

// ─── Browser configs ──────────────────────────────────────────────────

const browsers = [
  {
    name: 'Chrome',
    launch: () => chromium.launch({
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${WAV_PATH}`,
      ],
    }),
  },
  {
    name: 'Firefox',
    launch: () => firefox.launch({
      firefoxUserPrefs: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
      },
    }),
  },
  {
    name: 'WebKit',
    launch: () => webkit.launch(),
  },
];

// ─── Test runner ──────────────────────────────────────────────────────

async function testBrowser({ name, launch }) {
  const logs = [];
  let browser;

  try {
    browser = await launch();
    // Chromium supports permissions API; Firefox/WebKit use browser prefs instead
    const context = await browser.newContext(
      name === 'Chrome' ? { permissions: ['microphone'] } : {}
    );
    const page = await context.newPage();

    // Capture console
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[VAD]') || text.includes('getUserMedia') || text.includes('AudioContext')) {
        logs.push(text);
      }
    });
    page.on('pageerror', err => logs.push(`PAGE_ERROR: ${err.message}`));

    // Navigate and wait for page load
    await page.goto(`${BASE_URL}${TEST_PAGE}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    // Click the FAB or "Try it now" to open voice agent
    const tryBtn = page.locator('text=Try it now');
    const fab = page.locator('[data-testid="voice-agent-fab"]');
    if (await tryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tryBtn.click();
    } else if (await fab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fab.click();
    }

    // Wait for panel to appear
    await page.waitForSelector('[data-testid="voice-agent-panel"]', { timeout: 5000 }).catch(() => {});

    // Expand bar if collapsed
    const bar = page.locator('[data-testid="voice-agent-bar"]');
    if (await bar.isVisible({ timeout: 2000 }).catch(() => false)) {
      await bar.click();
    }

    // Wait for VAD pipeline to initialize and process frames
    // The fake mic continuously feeds audio, so frames should flow quickly
    await page.waitForTimeout(8000);

    // Collect any remaining console messages
    await page.waitForTimeout(500);

    await browser.close();
    return formatResult(name, logs);
  } catch (err) {
    logs.push(`TEST_ERROR: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    return formatResult(name, logs);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

console.log(`\nVAD Cross-Browser Test`);
console.log(`URL: ${BASE_URL}${TEST_PAGE}`);
console.log(`WAV: ${WAV_PATH}`);
console.log('─'.repeat(60));

const results = [];
for (const config of browsers) {
  process.stdout.write(`\n${config.name}: testing...`);
  const result = await testBrowser(config);
  results.push(result);

  const status = result.ok ? '\x1b[32m✓ PASS\x1b[0m' : '\x1b[31m✗ FAIL\x1b[0m';
  process.stdout.write(`\r${config.name}: ${status}\n`);
  console.log(`  ${result.pipeline.join(' → ')}`);
  if (!result.ok && result.logs.length > 0) {
    console.log(`  Logs:`);
    for (const log of result.logs.slice(-5)) {
      console.log(`    ${log.slice(0, 120)}`);
    }
  }
}

console.log('\n' + '─'.repeat(60));
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} browsers passed`);

if (passed < results.length) {
  console.log('\nFailed browsers:');
  for (const r of results.filter(r => !r.ok)) {
    console.log(`  ${r.name}: ${r.pipeline.join(' → ')}`);
  }
}

process.exit(passed === results.length ? 0 : 1);
