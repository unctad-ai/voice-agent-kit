export interface TtsProviderConfig {
  ttsProvider: string; // 'vllm-omni' | 'qwen3-tts' | 'chatterbox-turbo' | 'cosyvoice' | 'pocket-tts' | 'luxtts' | 'resemble'
  vllmOmniUrl: string;
  vllmOmniRefAudio: string;
  vllmOmniRefText: string;
  qwen3TtsUrl: string;
  chatterboxTurboUrl: string;
  cosyVoiceTtsUrl: string;
  luxTtsUrl: string;
  luxTtsSpeed: number;
  luxTtsTShift: number;
  pocketTtsUrl: string;
  resembleApiKey: string;
  resembleModel: string;
  resembleVoiceUuid: string;
  getActiveVoiceId?: () => string;
  /** When true, fall back to pocket-tts then Resemble if primary TTS fails. Default: false */
  ttsFallback: boolean;
  /** True when the TTS provider returns raw PCM (no WAV header). Set automatically. */
  rawPcm?: boolean;
}

export async function synthesizeWithVllmOmni(
  text: string,
  url: string,
  signal?: AbortSignal,
  opts?: { refAudio?: string; refText?: string }
): Promise<Response> {
  const providerTimeout = AbortSignal.timeout(50_000);
  const body: Record<string, unknown> = {
    input: text,
    stream: true,
    response_format: 'pcm',
  };
  if (opts?.refAudio) {
    body.task_type = 'Base';
    body.ref_audio = opts.refAudio;
    body.ref_text = opts.refText || '';
    body.x_vector_only_mode = true;
  }
  return fetch(`${url}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export async function synthesizeWithQwen3TTS(
  text: string,
  url: string,
  signal?: AbortSignal,
  opts?: { temperature?: number; voice?: string }
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);
  if (opts?.temperature != null) formData.append('temperature', String(opts.temperature));
  if (opts?.voice) formData.append('voice', opts.voice);

  // Use /tts-pipeline for token-level streaming: first chunk in ~400ms vs ~2-3s.
  // The TTS server's gpu_lock has a watchdog that auto-releases after 45s if a
  // CUDA generator hangs on client disconnect, preventing permanent deadlock.
  const providerTimeout = AbortSignal.timeout(50_000);
  return fetch(`${url}/tts-pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export async function synthesizeWithChatterboxTurbo(
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

export async function synthesizeWithCosyVoice(
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

export async function synthesizeWithPocketTTS(
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

export async function synthesizeWithLuxTTS(
  text: string,
  url: string,
  signal?: AbortSignal,
  opts?: { temperature?: number; voice?: string; speed?: number; tShift?: number }
): Promise<Response> {
  const formData = new URLSearchParams();
  formData.append('text', text);
  if (opts?.speed != null) formData.append('speed', String(opts.speed));

  // Expressiveness overrides config t_shift: map 0-1 range to 0.2-1.0
  const effectiveTShift = opts?.temperature != null
    ? 0.2 + (opts.temperature * 0.8)
    : opts?.tShift;
  if (effectiveTShift != null) formData.append('t_shift', String(effectiveTShift));

  if (opts?.voice) formData.append('voice', opts.voice);

  const providerTimeout = AbortSignal.timeout(30_000);
  return fetch(`${url}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    signal: signal ? AbortSignal.any([signal, providerTimeout]) : providerTimeout,
  });
}

export async function synthesizeWithResemble(
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

/**
 * Main TTS entry point. Selects the configured provider and applies the fallback chain.
 */
export async function synthesize(
  text: string,
  config: TtsProviderConfig,
  signal?: AbortSignal,
  opts?: { temperature?: number }
): Promise<Response> {
  const {
    ttsProvider,
    vllmOmniUrl,
    vllmOmniRefAudio,
    vllmOmniRefText,
    qwen3TtsUrl,
    chatterboxTurboUrl,
    cosyVoiceTtsUrl,
    pocketTtsUrl,
    resembleApiKey,
    resembleModel,
    resembleVoiceUuid,
    getActiveVoiceId,
    ttsFallback,
  } = config;

  const voiceId = getActiveVoiceId?.() || '';

  function callResemble(s?: AbortSignal): Promise<Response> {
    return synthesizeWithResemble(text, resembleApiKey, resembleModel, resembleVoiceUuid, s);
  }

  let response: Response;

  if (ttsProvider === 'vllm-omni') {
    config.rawPcm = true;
    response = await synthesizeWithVllmOmni(text, vllmOmniUrl, signal, {
      refAudio: vllmOmniRefAudio || undefined,
      refText: vllmOmniRefText || undefined,
    });
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] vllm-omni failed, falling back to pocket-tts');
      config.rawPcm = false;
      response = await synthesizeWithPocketTTS(text, pocketTtsUrl, signal);
      if (!response.ok) {
        console.warn('[TTS] pocket-tts failed, falling back to Resemble');
        response = await callResemble(signal);
      }
    }
  } else if (ttsProvider === 'qwen3-tts') {
    response = await synthesizeWithQwen3TTS(text, qwen3TtsUrl, signal, { temperature: opts?.temperature, voice: voiceId });
    // Retry once on 503 (GPU lock may be releasing via watchdog)
    if (response.status === 503 && !signal?.aborted) {
      console.warn('[TTS] qwen3-tts 503, retrying in 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      response = await synthesizeWithQwen3TTS(text, qwen3TtsUrl, signal, { temperature: opts?.temperature, voice: voiceId });
    }
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] qwen3-tts failed, falling back to pocket-tts');
      response = await synthesizeWithPocketTTS(text, pocketTtsUrl, signal);
      if (!response.ok) {
        console.warn('[TTS] pocket-tts failed, falling back to Resemble');
        response = await callResemble(signal);
      }
    }
  } else if (ttsProvider === 'chatterbox-turbo') {
    response = await synthesizeWithChatterboxTurbo(text, chatterboxTurboUrl, signal);
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] chatterbox-turbo failed, falling back to pocket-tts');
      response = await synthesizeWithPocketTTS(text, pocketTtsUrl, signal);
      if (!response.ok) {
        console.warn('[TTS] pocket-tts failed, falling back to Resemble');
        response = await callResemble(signal);
      }
    }
  } else if (ttsProvider === 'cosyvoice') {
    response = await synthesizeWithCosyVoice(text, cosyVoiceTtsUrl, signal);
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] cosyvoice failed, falling back to pocket-tts');
      response = await synthesizeWithPocketTTS(text, pocketTtsUrl, signal);
      if (!response.ok) {
        console.warn('[TTS] pocket-tts failed, falling back to Resemble');
        response = await callResemble(signal);
      }
    }
  } else if (ttsProvider === 'luxtts') {
    response = await synthesizeWithLuxTTS(text, config.luxTtsUrl, signal, {
      speed: config.luxTtsSpeed,
      tShift: config.luxTtsTShift,
      voice: voiceId,
      temperature: opts?.temperature,
    });
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] luxtts failed, falling back to pocket-tts');
      response = await synthesizeWithPocketTTS(text, pocketTtsUrl, signal);
      if (!response.ok) {
        console.warn('[TTS] pocket-tts failed, falling back to Resemble');
        response = await callResemble(signal);
      }
    }
  } else if (ttsProvider === 'pocket-tts') {
    response = await synthesizeWithPocketTTS(text, pocketTtsUrl, signal);
    if (!response.ok && ttsFallback) {
      console.warn('[TTS] pocket-tts failed, falling back to Resemble');
      response = await callResemble(signal);
    }
  } else {
    response = await callResemble(signal);
  }

  return response;
}
