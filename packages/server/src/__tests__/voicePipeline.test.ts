import { describe, it, expect } from 'vitest';
import { sanitizeForTTS } from '../textUtils.js';

describe('voicePipeline text processing', () => {
  it('sanitizes LLM output before TTS', () => {
    const llmOutput = '<think>reasoning</think>**Hello!** How can I help? [END_SESSION]';
    const sanitized = sanitizeForTTS(llmOutput);
    expect(sanitized).not.toContain('<think>');
    expect(sanitized).not.toContain('**');
    expect(sanitized).not.toContain('[END_SESSION]');
    expect(sanitized).toContain('Hello');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeForTTS('')).toBe('');
  });

  it('strips markdown formatting', () => {
    const input = '# Title\n**bold** and *italic* text';
    const sanitized = sanitizeForTTS(input);
    expect(sanitized).not.toContain('#');
    expect(sanitized).not.toContain('**');
    expect(sanitized).not.toContain('*');
    expect(sanitized).toContain('bold');
    expect(sanitized).toContain('italic');
  });

  it('strips emoji characters', () => {
    const input = 'Hello! 😀 How are you? 🎉';
    const sanitized = sanitizeForTTS(input);
    expect(sanitized).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
    expect(sanitized).not.toMatch(/[\u{1F300}-\u{1F5FF}]/u);
    expect(sanitized).toContain('Hello');
  });

  it('strips chain-of-thought blocks', () => {
    const input = '<think>Let me think about this carefully.</think>The answer is 42.';
    const sanitized = sanitizeForTTS(input);
    expect(sanitized).not.toContain('think');
    expect(sanitized).toContain('42');
  });

  it('caps output at word limit', () => {
    const longInput = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    const sanitized = sanitizeForTTS(longInput, 10);
    const wordCount = sanitized.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(11); // 10 words + possible period
  });
});
