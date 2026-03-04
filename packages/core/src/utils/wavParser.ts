/**
 * WAV header parser and PCM-to-Float32 converter for streaming TTS playback.
 *
 * Parses the standard 44-byte RIFF/WAVE PCM header and converts raw PCM
 * bytes (16-bit or 32-bit) into Float32 samples for Web Audio API AudioBuffers.
 *
 * Resemble Chatterbox outputs 32-bit PCM mono at 32kHz.
 */

export interface WavHeader {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  bytesPerSample: number;
  blockAlign: number;
}

/**
 * Parse a 44-byte WAV header from raw bytes.
 * Validates RIFF/WAVE magic bytes and extracts audio format parameters.
 */
export function parseWavHeader(header: Uint8Array): WavHeader {
  if (header.length < 44) {
    throw new Error(`WAV header too short: ${header.length} bytes (need 44)`);
  }

  // Validate RIFF magic (bytes 0-3)
  const riff =
    String.fromCharCode(header[0]) +
    String.fromCharCode(header[1]) +
    String.fromCharCode(header[2]) +
    String.fromCharCode(header[3]);
  if (riff !== 'RIFF') {
    throw new Error(`Invalid WAV: expected RIFF, got "${riff}"`);
  }

  // Validate WAVE format (bytes 8-11)
  const wave =
    String.fromCharCode(header[8]) +
    String.fromCharCode(header[9]) +
    String.fromCharCode(header[10]) +
    String.fromCharCode(header[11]);
  if (wave !== 'WAVE') {
    throw new Error(`Invalid WAV: expected WAVE, got "${wave}"`);
  }

  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

  // audioFormat (bytes 20-21): 1 = PCM, other values = compressed formats we don't support
  const audioFormat = view.getUint16(20, true);
  if (audioFormat !== 1) {
    throw new Error(
      `Unsupported WAV audio format: ${audioFormat} (expected 1 for PCM). ` +
        `Compressed WAV formats are not supported.`
    );
  }

  const numChannels = view.getUint16(22, true);
  if (numChannels !== 1) {
    throw new Error(
      `Unsupported WAV channel count: ${numChannels} (expected 1). ` +
        `The audio pipeline assumes mono input.`
    );
  }

  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = view.getUint16(32, true);

  return { sampleRate, numChannels, bitsPerSample, bytesPerSample, blockAlign };
}

/**
 * Convert raw PCM bytes to Float32 samples (-1.0 to 1.0).
 * Supports 16-bit and 32-bit signed integer PCM (mono).
 * Resemble Chatterbox outputs 32-bit PCM mono at 32kHz.
 */
export function pcmToFloat32(pcm: Uint8Array, header: WavHeader): Float32Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const numSamples = Math.floor(pcm.length / header.bytesPerSample);
  const float32 = new Float32Array(numSamples);

  if (header.bitsPerSample === 16) {
    for (let i = 0; i < numSamples; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }
  } else if (header.bitsPerSample === 32) {
    for (let i = 0; i < numSamples; i++) {
      float32[i] = view.getInt32(i * 4, true) / 2147483648;
    }
  } else {
    throw new Error(`Unsupported bits per sample: ${header.bitsPerSample} (need 16 or 32)`);
  }

  return float32;
}
