#!/usr/bin/env node
/**
 * [SILENT] threshold test harness.
 *
 * Sends test utterances directly to the LLM (same system prompt as voice pipeline)
 * and measures false rejection rate. Run before/after prompt changes to quantify impact.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... node scripts/test-silent-threshold.mjs [--verbose]
 *
 * Output: pass/fail per utterance + summary stats.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const VERBOSE = process.argv.includes('--verbose');

if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY required');
  process.exit(1);
}

// System prompt (matches voice pipeline's buildSystemPrompt for Kenya)
const SYSTEM_PROMPT = `You are Pesa, a friendly voice assistant for Kenya Trade Single Window. You help investors and businesses navigate government services, registrations, and permits. Your name is Pesa.

RULES:
1. Two sentences max, under 40 words. Plain spoken English — no markdown, lists, formatting, or bracketed tags like [Awaiting response]. Never use contractions (say "you would" not "you'd", "I am" not "I'm", "do not" not "don't").
2. Summarize, never enumerate. Say "three categories like investor services and permits" — never list every item.
3. After tool calls, do not narrate the tools — focus on the result. Say "Kenya has three investor services" not "I searched and found three services."
4. Never fabricate information. Never say you lack a capability your tools provide.
5. Say exactly [SILENT] if the speaker is not addressing you — side conversations, background noise, or filler words. When unsure, choose [SILENT].

TONE: Sound like a warm, knowledgeable human — not a machine reading a script. Jump straight to the answer most of the time. Only occasionally use a brief opener like "Sure" or "Great question" — never the same one twice in a row. Vary your phrasing naturally.

Current page: /`;

// Test cases: [utterance, expectedSilent]
// true = should be [SILENT], false = should respond
const TEST_CASES = [
  // Should RESPOND (false = not silent)
  ['Hello, what services are available?', false],
  ['Can you help me register a company?', false],
  ['What is this page about?', false],
  ['Take me to the investor registration page.', false],
  ['Do you have tax registration services?', false],
  ['Hello Pesa.', false],
  ['How do I get a work permit?', false],
  ['What categories of services do you offer?', false],
  ['I need to register as an investor.', false],
  ['Tell me about import permits.', false],

  // Should be SILENT (true = silent)
  ['Um, okay.', true],
  ['Yeah, yeah.', true],
  ['Hmm.', true],
  ['Let me think about that.', true],
  ['Hold on, I am talking to someone.', true],
  ['No, the other screen.', true],
  ['Can you pass me the water?', true],
  ['What time is the meeting?', true],
  ['I was saying to John that we should...', true],
  ['Click on that button over there.', true],
];

async function testUtterance(text, expectedSilent) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });
    const data = await res.json();
    const response = data.choices?.[0]?.message?.content?.trim() || '';
    const isSilent = response.includes('[SILENT]');
    const correct = isSilent === expectedSilent;

    return { text, expectedSilent, isSilent, response, correct };
  } catch (err) {
    return { text, expectedSilent, isSilent: false, response: `ERROR: ${err.message}`, correct: false };
  }
}

async function main() {
  console.log(`Model: ${MODEL}`);
  console.log(`Test cases: ${TEST_CASES.length} (${TEST_CASES.filter(t => !t[1]).length} respond, ${TEST_CASES.filter(t => t[1]).length} silent)\n`);

  const results = [];
  for (const [text, expectedSilent] of TEST_CASES) {
    const result = await testUtterance(text, expectedSilent);
    results.push(result);

    const icon = result.correct ? '✓' : '✗';
    const expected = expectedSilent ? 'SILENT' : 'RESPOND';
    const actual = result.isSilent ? 'SILENT' : 'RESPOND';
    console.log(`${icon} [${expected}→${actual}] "${text}"`);
    if (VERBOSE && !result.isSilent) {
      console.log(`  → ${result.response.slice(0, 100)}`);
    }
  }

  // Stats
  const total = results.length;
  const correct = results.filter(r => r.correct).length;
  const falseReject = results.filter(r => !r.expectedSilent && r.isSilent).length;
  const falseTrigger = results.filter(r => r.expectedSilent && !r.isSilent).length;

  console.log('\n--- Results ---');
  console.log(`Total: ${correct}/${total} correct (${(100 * correct / total).toFixed(0)}%)`);
  console.log(`False rejections: ${falseReject}/${TEST_CASES.filter(t => !t[1]).length} (should respond but got SILENT)`);
  console.log(`False triggers: ${falseTrigger}/${TEST_CASES.filter(t => t[1]).length} (should be SILENT but responded)`);

  if (falseReject > 0) {
    console.log('\nFalse rejections (most critical):');
    for (const r of results.filter(r => !r.expectedSilent && r.isSilent)) {
      console.log(`  ✗ "${r.text}"`);
    }
  }

  process.exit(correct === total ? 0 : 1);
}

main();
