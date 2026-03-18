import { describe, it, expect } from 'vitest';
import { sanitizeForTTS, stripChainOfThought } from '../textUtils.js';

describe('stripChainOfThought', () => {
  it('strips tagged CoT', () => {
    expect(stripChainOfThought('<think>reasoning here</think>actual answer'))
      .toBe('actual answer');
  });
  it('strips multiline tagged CoT', () => {
    expect(stripChainOfThought('<think>\nline1\nline2\n</think>answer'))
      .toBe('answer');
  });
  it('strips untagged CoT with reasoning patterns', () => {
    const input = 'we need to check the rules\n\nThe answer is 42.';
    expect(stripChainOfThought(input)).toBe('The answer is 42.');
  });
  it('preserves normal text without CoT', () => {
    expect(stripChainOfThought('Hello, how can I help?')).toBe('Hello, how can I help?');
  });
});

describe('sanitizeForTTS', () => {
  it('strips markdown bold', () => {
    expect(sanitizeForTTS('**bold text**')).toBe('bold text');
  });
  it('strips emoji', () => {
    const result = sanitizeForTTS('Hello! 😀 How are you?');
    expect(result).not.toContain('😀');
  });
  it('replaces & with "and"', () => {
    expect(sanitizeForTTS('salt & pepper')).toBe('salt and pepper');
  });
  it('strips bracketed stage directions', () => {
    expect(sanitizeForTTS('Hello [END_SESSION]')).toBe('Hello');
  });
  it('caps text at maxWords', () => {
    const longText = Array(100).fill('word').join(' ') + '.';
    const result = sanitizeForTTS(longText, 10);
    const wordCount = result.split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(11);
  });
  it('strips CoT before sanitizing', () => {
    const input = '<think>let me think</think>**Answer here**';
    expect(sanitizeForTTS(input)).toBe('Answer here');
  });

  it('converts em dashes to commas for TTS pauses', () => {
    expect(sanitizeForTTS('three services \u2014 like permits')).toBe('three services , like permits');
  });
  it('keeps hyphens as hyphens for compound words', () => {
    expect(sanitizeForTTS('well\u2010known fact')).toBe('well-known fact');
  });
  it('preserves ellipsis as TTS hesitation pause', () => {
    expect(sanitizeForTTS('well... let me check')).toBe('well... let me check');
  });

  it('strips <internal> tags and content from TTS output', () => {
    const input = 'Action completed. <internal>Check UI_ACTIONS for valid action IDs.</internal>';
    expect(sanitizeForTTS(input)).toBe('Action completed.');
  });

  it('strips <internal> tags that span multiple lines', () => {
    const input = 'Done. <internal>\nCheck UI_ACTIONS\nfor next step.\n</internal> Great.';
    const result = sanitizeForTTS(input);
    expect(result).not.toContain('UI_ACTIONS');
    expect(result).toBe('Done. Great.');
  });
});
