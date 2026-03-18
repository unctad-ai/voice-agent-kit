export interface QualityWarning {
  type: 'too-short' | 'too-quiet' | 'clipping';
  blocking: boolean;
  message: string;
}

/**
 * Encode Float32 PCM samples into a WAV Blob (16-bit, mono).
 */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const numSamples = pcm.length;
  const bytesPerSample = 2; // Int16
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);            // subchunk size
  view.setUint16(20, 1, true);             // PCM format
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true);            // bits per sample

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert Float32 [-1,1] to Int16
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Check recording quality. Returns the most severe warning, or null if OK.
 * Checks ordered by severity: too-short (blocking) > clipping > too-quiet.
 */
export function checkQuality(pcm: Float32Array, sampleRate: number): QualityWarning | null {
  const durationSec = pcm.length / sampleRate;

  if (durationSec < 8) {
    return { type: 'too-short', blocking: true, message: 'Recording too short for good voice cloning. Try again.' };
  }

  let clipped = 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const abs = Math.abs(pcm[i]);
    if (abs >= 0.99) clipped++;
    sumSq += pcm[i] * pcm[i];
  }

  if (clipped / pcm.length > 0.05) {
    return { type: 'clipping', blocking: false, message: 'Audio may be distorted. Try speaking a bit softer.' };
  }

  const rms = Math.sqrt(sumSq / pcm.length);
  if (rms < 0.01) {
    return { type: 'too-quiet', blocking: false, message: 'Recording is very quiet. Try moving closer to your mic.' };
  }

  return null;
}
