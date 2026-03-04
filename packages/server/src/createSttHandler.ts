import { Router } from 'express';
import Groq from 'groq-sdk';
import multer from 'multer';

export interface SttHandlerOptions {
  groqApiKey?: string;
  sttProvider?: string;   // 'kyutai' | 'groq', default 'kyutai'
  kyutaiSttUrl?: string;  // default 'http://5.9.49.171:8003'
}

// --- Response type shared by both providers ---
interface STTResponse {
  text: string;
  language: string;
  noSpeechProb: number;
  avgLogprob: number;
}

export function createSttHandler(options: SttHandlerOptions): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  });

  const sttProvider = options.sttProvider || 'kyutai';
  const kyutaiSttUrl = options.kyutaiSttUrl || 'http://5.9.49.171:8003';

  // Groq client — only initialized when needed
  let groq: Groq | null = null;
  function getGroq(): Groq {
    if (!groq) {
      if (!options.groqApiKey) {
        throw new Error('groqApiKey not set — cannot use Groq STT');
      }
      groq = new Groq({ apiKey: options.groqApiKey });
    }
    return groq;
  }

  // --- Kyutai STT ---
  async function transcribeWithKyutai(wavBuffer: Buffer): Promise<STTResponse> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');

    const res = await fetch(`${kyutaiSttUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Kyutai STT HTTP ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { text: string; vadProbs: number[] };

    // Map Kyutai VAD to Whisper-compatible format:
    // vadProbs[2] = P(no voice activity in 2s) — maps to Whisper's no_speech_prob
    const noSpeechProb = data.vadProbs?.[2] ?? 0;

    // Derive confidence proxy from aggregate VAD probabilities.
    // Low mean VAD probability -> audio is likely not speech -> mapped to negative logprob
    const vadProbs = data.vadProbs ?? [];
    const meanVadProb = vadProbs.length > 0
      ? vadProbs.reduce((s: number, v: number) => s + v, 0) / vadProbs.length
      : 1; // no probs = assume speech
    const avgLogprob = vadProbs.length > 0 ? -1.0 * (1 - meanVadProb) : 0;

    return {
      text: data.text,
      language: 'en',
      noSpeechProb,
      avgLogprob,
    };
  }

  // --- Groq Whisper STT ---
  async function transcribeWithGroq(wavBuffer: Buffer): Promise<STTResponse> {
    const uint8 = new Uint8Array(wavBuffer);
    const file = new File([uint8], 'audio.wav', { type: 'audio/wav' });

    const transcription = await getGroq().audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      temperature: 0,
      response_format: 'verbose_json',
    });

    // verbose_json includes per-segment quality signals the type doesn't expose
    const verbose = transcription as unknown as {
      language?: string;
      segments?: Array<{ no_speech_prob?: number; avg_logprob?: number }>;
    };

    const segments = verbose.segments ?? [];
    const noSpeechProb =
      segments.length > 0
        ? Math.max(...segments.map((s) => s.no_speech_prob ?? 0))
        : 0;
    const avgLogprob =
      segments.length > 0
        ? segments.reduce((sum, s) => sum + (s.avg_logprob ?? 0), 0) / segments.length
        : 0;

    return {
      text: transcription.text,
      language: verbose.language ?? 'en',
      noSpeechProb,
      avgLogprob,
    };
  }

  // --- Route handler ---
  router.post('/', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No audio file provided' });
        return;
      }

      let response: STTResponse;
      let provider = sttProvider;
      const t0 = performance.now();

      if (sttProvider === 'kyutai') {
        try {
          response = await transcribeWithKyutai(req.file.buffer);
          if (!response.text) throw new Error('empty transcription');
        } catch (err) {
          console.warn('[STT] Kyutai failed, falling back to Groq:', (err as Error).message);
          provider = 'groq (fallback)';
          response = await transcribeWithGroq(req.file.buffer);
        }
      } else {
        response = await transcribeWithGroq(req.file.buffer);
      }

      const durationMs = Math.round(performance.now() - t0);
      const audioSizeKB = Math.round(req.file.buffer.length / 1024);

      console.log(
        '[STT]',
        JSON.stringify({
          provider,
          text: response.text,
          durationMs,
          audioSizeKB,
          noSpeechProb: response.noSpeechProb.toFixed(3),
          avgLogprob: response.avgLogprob.toFixed(3),
        })
      );

      res.json({ ...response, durationMs });
    } catch (error) {
      console.error('STT error:', error);
      res.status(500).json({ error: 'Transcription failed' });
    }
  });

  return router;
}
