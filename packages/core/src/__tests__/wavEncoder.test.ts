import { describe, it, expect } from 'vitest';
import { encodeWav, checkQuality } from '../hooks/wavEncoder';

describe('encodeWav', () => {
  it('produces a valid WAV blob from Float32 PCM', () => {
    // 1 second of silence at 16kHz
    const pcm = new Float32Array(16000);
    const blob = encodeWav(pcm, 16000);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/wav');
    // WAV header (44 bytes) + 16000 samples × 2 bytes (Int16)
    expect(blob.size).toBe(44 + 16000 * 2);
  });

  it('encodes non-zero samples with correct WAV header', async () => {
    const pcm = new Float32Array([0.5, -0.5, 1.0, -1.0]);
    const blob = encodeWav(pcm, 16000);
    const buf = new Uint8Array(await blob.arrayBuffer());

    // RIFF header
    const header = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    expect(header).toBe('RIFF');

    // WAVE format
    const format = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    expect(format).toBe('WAVE');

    // Sample rate at offset 24 (little-endian uint32)
    const sampleRate = buf[24] | (buf[25] << 8) | (buf[26] << 16) | (buf[27] << 24);
    expect(sampleRate).toBe(16000);

    // Bits per sample at offset 34 (little-endian uint16)
    const bitsPerSample = buf[34] | (buf[35] << 8);
    expect(bitsPerSample).toBe(16);

    // Channels at offset 22 (little-endian uint16)
    const channels = buf[22] | (buf[23] << 8);
    expect(channels).toBe(1);
  });
});

describe('checkQuality', () => {
  it('returns "too-short" for recordings under 8 seconds', () => {
    const pcm = new Float32Array(16000 * 5);
    pcm.fill(0.3);
    const result = checkQuality(pcm, 16000);
    expect(result).toEqual({
      type: 'too-short',
      blocking: true,
      message: expect.stringContaining('too short'),
    });
  });

  it('returns null for a good recording', () => {
    const pcm = new Float32Array(16000 * 10);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin(i * 0.1);
    const result = checkQuality(pcm, 16000);
    expect(result).toBeNull();
  });

  it('returns "too-quiet" warning for very low RMS', () => {
    const pcm = new Float32Array(16000 * 10);
    pcm.fill(0.001);
    const result = checkQuality(pcm, 16000);
    expect(result).toEqual({
      type: 'too-quiet',
      blocking: false,
      message: expect.stringContaining('quiet'),
    });
  });

  it('returns "clipping" warning when >5% samples near max', () => {
    const pcm = new Float32Array(16000 * 10);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = i < pcm.length * 0.1 ? 0.995 : 0.3 * Math.sin(i * 0.1);
    }
    const result = checkQuality(pcm, 16000);
    expect(result).toEqual({
      type: 'clipping',
      blocking: false,
      message: expect.stringContaining('distorted'),
    });
  });
});
