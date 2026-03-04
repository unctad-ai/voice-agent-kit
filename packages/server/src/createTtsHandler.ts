import { Router } from 'express';

export interface TtsHandlerOptions {
  ttsProvider?: string;  // 'qwen3-tts' | 'chatterbox-turbo' | 'cosyvoice' | 'pocket-tts' | 'resemble'
  qwen3TtsUrl?: string;
  chatterboxTurboUrl?: string;
  cosyVoiceTtsUrl?: string;
  pocketTtsUrl?: string;
  resembleApiKey?: string;
  resembleModel?: string;
  resembleVoiceUuid?: string;
}

/**
 * Strip reasoning-model chain-of-thought from LLM output.
 *
 * Reasoning models (gpt-oss-120b, DeepSeek, QwQ) emit their thinking
 * before the answer. Two patterns:
 *
 * 1. Tagged: <think>reasoning</think>actual answer
 *    The sanitizer's < > stripping removes the tags but leaves reasoning
 *    content — must strip BEFORE other sanitization.
 *
 * 2. Untagged: garbled preamble + \n\n + reasoning + actual answer
 *    Detected by meta-reasoning phrases ("we need to", "according to rules").
 *    The actual answer is always the LAST paragraph.
 */
function stripChainOfThought(raw: string): string {
  let text = raw;

  // Tagged CoT: <think>...</think> (may span multiple lines)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Untagged CoT: split on double-newline, check for reasoning patterns
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    const reasoningPatterns = /\b(we need to|we should|we must|according to rules|the user says|ensure no|two sentences|under \d+ words|no markdown|no contractions|let me think|so we|that'?s \d+ sentences)\b/i;
    const hasReasoning = paragraphs.slice(0, -1).some(p => reasoningPatterns.test(p));
    if (hasReasoning) {
      text = paragraphs[paragraphs.length - 1];
    }
  }

  return text.trim();
}

/**
 * Sanitize text for TTS engines.
 * Strips CoT reasoning, markdown/emoji, escapes SSML chars, caps length.
 */
function sanitizeForTTS(raw: string, maxWords = 60): string {
  // Strip chain-of-thought FIRST — before < > removal destroys the tags
  let text = stripChainOfThought(raw)
    // Strip emoji
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2705}\u{274C}\u{2714}\u{2716}]/gu, '')
    // Normalize Unicode dashes
    .replace(/[\u{2010}\u{2011}\u{2012}\u{2013}\u{2014}\u{2015}]/gu, '-')
    // Strip markdown formatting
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/^\|.*\|$/gm, '')
    .replace(/^\|[-:| ]+\|$/gm, '')
    .replace(/\|/g, ',')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^[\s]*[-*]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Strip bracketed stage directions ([Awaiting response], [END_SESSION], etc.)
    .replace(/\[[^\]]{2,}\]/g, '')
    // SSML-breaking characters
    .replace(/&/g, 'and')
    .replace(/</g, '')
    .replace(/>/g, '')
    // Collapse whitespace and double periods
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\.\s*\./g, '.')
    .trim();

  // Cap at ~maxWords words for listening UX — cut at sentence boundary.
  const words = text.split(/\s+/);
  if (words.length > maxWords) {
    const joined = words.slice(0, maxWords).join(' ');
    const lastSentence = Math.max(joined.lastIndexOf('. '), joined.lastIndexOf('? '));
    text = lastSentence > 0 ? joined.slice(0, lastSentence + 1) : joined.replace(/[,;:\s]+$/, '') + '.';
  }

  return text;
}

// --- TTS provider functions ---

async function synthesizeWithQwen3TTS(
  text: string,
  url: string,
  signal?: AbortSignal,
  opts?: { temperature?: number }
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);
  if (opts?.temperature != null) formData.append('temperature', String(opts.temperature));

  // Uses /tts-pipeline for token-level streaming: audio chunks yielded as codec
  // tokens are generated. TTFA ~200ms with two-phase emission + Hann crossfade.
  // 50s timeout: accounts for GPU lock wait (up to 15s) + generation (up to 25s).
  const providerTimeout = AbortSignal.timeout(50_000);
  return fetch(`${url}/tts-pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

async function synthesizeWithChatterboxTurbo(
  text: string,
  url: string,
  signal?: AbortSignal
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);

  // Use /tts-pipeline for sentence-level pipelining: splits text into sentences,
  // generates each sequentially, streams PCM as each sentence completes.
  const providerTimeout = AbortSignal.timeout(30_000);
  return fetch(`${url}/tts-pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

async function synthesizeWithCosyVoice(
  text: string,
  url: string,
  signal?: AbortSignal
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);

  const providerTimeout = AbortSignal.timeout(15_000);
  return fetch(`${url}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

async function synthesizeWithPocketTTS(
  text: string,
  url: string,
  signal?: AbortSignal
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);

  const providerTimeout = AbortSignal.timeout(30_000); // Pocket TTS generates at ~0.5x RT on CPU
  return fetch(`${url}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

async function synthesizeWithResemble(
  text: string,
  apiKey: string,
  model: string,
  voiceUuid: string,
  signal?: AbortSignal
): Promise<Response> {
  const providerTimeout = AbortSignal.timeout(10_000);
  return fetch('https://f.cluster.resemble.ai/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'voice-agent-kit/1.0',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      voice_uuid: voiceUuid,
      data: text,
      output_format: 'wav',
    }),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export function createTtsHandler(options: TtsHandlerOptions): Router {
  const router = Router();

  const ttsProvider = options.ttsProvider || 'resemble';
  const qwen3TtsUrl = options.qwen3TtsUrl || 'http://localhost:8005';
  const chatterboxTurboUrl = options.chatterboxTurboUrl || 'http://localhost:8004';
  const cosyVoiceTtsUrl = options.cosyVoiceTtsUrl || 'http://localhost:8004';
  const pocketTtsUrl = options.pocketTtsUrl || 'http://pocket-tts:8002';
  const resembleApiKey = options.resembleApiKey || '';
  const resembleModel = options.resembleModel || '';
  const resembleVoiceUuid = options.resembleVoiceUuid || '';

  // Helper to call Resemble with options closure
  function callResemble(text: string, signal?: AbortSignal): Promise<Response> {
    return synthesizeWithResemble(text, resembleApiKey, resembleModel, resembleVoiceUuid, signal);
  }

  router.post('/', async (req, res) => {
    // Global AbortController: aborts upstream fetch on client disconnect or overall timeout.
    // 60s cap prevents the fallback cascade (up to 90s worst-case) from running unchecked.
    const globalAc = new AbortController();
    const globalTimeout = AbortSignal.timeout(60_000);
    const signal = AbortSignal.any([globalAc.signal, globalTimeout]);

    // Abort upstream fetch when client disconnects (barge-in, navigation, tab close).
    // MUST use res.on('close'), NOT req.on('close'): in Node 22, req 'close' fires
    // when the request body is consumed (auto-destroy on Readable), not on disconnect.
    // res 'close' fires when the response connection actually closes.
    res.on('close', () => {
      if (!res.writableFinished) {
        console.debug('[TTS] client disconnected before response complete, aborting upstream');
        globalAc.abort();
      }
    });

    try {
      const { text, temperature: rawTemp, maxWords: rawMaxWords } = req.body;

      if (!text) {
        res.status(400).json({ error: 'No text provided' });
        return;
      }

      if (typeof text !== 'string' || text.length > 2000) {
        res.status(400).json({ error: 'Text must be a string of 2000 characters or less' });
        return;
      }

      // Validate optional temperature (0-1)
      let temperature: number | undefined;
      if (rawTemp != null) {
        temperature = Number(rawTemp);
        if (isNaN(temperature) || temperature < 0 || temperature > 1) {
          res.status(400).json({ error: 'temperature must be between 0 and 1' });
          return;
        }
      }

      // Validate optional maxWords (10-200)
      let maxWords: number | undefined;
      if (rawMaxWords != null) {
        maxWords = Number(rawMaxWords);
        if (isNaN(maxWords) || maxWords < 10 || maxWords > 200) {
          res.status(400).json({ error: 'maxWords must be between 10 and 200' });
          return;
        }
      }

      const sanitized = sanitizeForTTS(text, maxWords);
      console.debug('[TTS] provider:', ttsProvider);
      console.debug('[TTS] raw:', JSON.stringify(text));
      console.debug('[TTS] sanitized:', JSON.stringify(sanitized));

      const ttsStartTime = performance.now();
      let response: Response;

      if (ttsProvider === 'qwen3-tts') {
        try {
          response = await synthesizeWithQwen3TTS(sanitized, qwen3TtsUrl, signal, { temperature });
          if (!response.ok) throw new Error(`qwen3-tts ${response.status}`);
        } catch (err) {
          if (signal.aborted) throw err; // Don't fallback if globally aborted
          console.warn('[TTS] qwen3-tts failed, falling back to pocket-tts:', err);
          try {
            response = await synthesizeWithPocketTTS(sanitized, pocketTtsUrl, signal);
            if (!response.ok) throw new Error(`pocket-tts ${response.status}`);
          } catch (err2) {
            if (signal.aborted) throw err2;
            console.warn('[TTS] pocket-tts failed, falling back to Resemble:', err2);
            response = await callResemble(sanitized, signal);
          }
        }
      } else if (ttsProvider === 'chatterbox-turbo') {
        try {
          response = await synthesizeWithChatterboxTurbo(sanitized, chatterboxTurboUrl, signal);
          if (!response.ok) throw new Error(`chatterbox-turbo ${response.status}`);
        } catch (err) {
          if (signal.aborted) throw err;
          console.warn('[TTS] chatterbox-turbo failed, falling back to pocket-tts:', err);
          try {
            response = await synthesizeWithPocketTTS(sanitized, pocketTtsUrl, signal);
            if (!response.ok) throw new Error(`pocket-tts ${response.status}`);
          } catch (err2) {
            if (signal.aborted) throw err2;
            console.warn('[TTS] pocket-tts failed, falling back to Resemble:', err2);
            response = await callResemble(sanitized, signal);
          }
        }
      } else if (ttsProvider === 'cosyvoice') {
        try {
          response = await synthesizeWithCosyVoice(sanitized, cosyVoiceTtsUrl, signal);
          if (!response.ok) throw new Error(`cosyvoice ${response.status}`);
        } catch (err) {
          if (signal.aborted) throw err;
          console.warn('[TTS] cosyvoice failed, falling back to pocket-tts:', err);
          try {
            response = await synthesizeWithPocketTTS(sanitized, pocketTtsUrl, signal);
            if (!response.ok) throw new Error(`pocket-tts ${response.status}`);
          } catch (err2) {
            if (signal.aborted) throw err2;
            console.warn('[TTS] pocket-tts failed, falling back to Resemble:', err2);
            response = await callResemble(sanitized, signal);
          }
        }
      } else if (ttsProvider === 'pocket-tts') {
        try {
          response = await synthesizeWithPocketTTS(sanitized, pocketTtsUrl, signal);
          if (!response.ok) throw new Error(`pocket-tts ${response.status}`);
        } catch (err) {
          if (signal.aborted) throw err;
          console.warn('[TTS] pocket-tts failed, falling back to Resemble:', err);
          response = await callResemble(sanitized, signal);
        }
      } else {
        response = await callResemble(sanitized, signal);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[TTS] API error:', response.status, errorText);
        // Normalize all upstream errors to 502 Bad Gateway
        res.status(502).json({ error: 'TTS request failed' });
        return;
      }

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Transfer-Encoding', 'chunked');

      const reader = response.body?.getReader();
      if (!reader) {
        res.status(500).json({ error: 'No response body from TTS' });
        return;
      }

      // Forward chunks as they arrive from upstream TTS provider.
      // Handles backpressure (pause reading when Express buffer is full)
      // and client disconnect (cancel reader to stop upstream consumption).
      let firstChunkSent = false;
      let ttfaMs = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (!firstChunkSent) {
            firstChunkSent = true;
            ttfaMs = Math.round(performance.now() - ttsStartTime);
            // Add Server-Timing header before first write so client can read TTFA
            res.setHeader('Server-Timing', `ttfa;dur=${ttfaMs}`);
            // Flush headers now that Server-Timing is set
            res.flushHeaders();
          }

          const canContinue = res.write(value);
          if (!canContinue) {
            // Express buffer is full — wait for drain before reading more
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
      } catch (streamErr) {
        // Reader cancelled (client disconnect) or global timeout — clean up silently
        reader.cancel().catch(() => {});
      } finally {
        const totalMs = Math.round(performance.now() - ttsStartTime);
        // Update Server-Timing with total duration (only works if headers not yet flushed,
        // otherwise the TTFA-only header was already sent — that's fine)
        if (!firstChunkSent) {
          res.setHeader('Server-Timing', `ttfa;dur=0, total;dur=${totalMs}`);
          res.flushHeaders();
        }
        console.log(
          '[TTS]',
          JSON.stringify({
            provider: ttsProvider,
            ttfaMs,
            totalMs,
            textLen: sanitized.length,
          })
        );
        res.end();
      }
    } catch (error) {
      console.error('[TTS] error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'TTS request failed' });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}
