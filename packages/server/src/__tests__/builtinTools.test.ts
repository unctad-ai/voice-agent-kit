import { describe, it, expect } from 'vitest';
import { levenshtein, fuzzySearch, buildSynonymMap } from '../builtinTools.js';
import type { ServiceBase } from '@unctad-ai/voice-agent-core';

// --- levenshtein ---

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('computes single-char substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('computes insertion distance', () => {
    expect(levenshtein('kit', 'kitten')).toBe(3);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshtein('', '')).toBe(0);
  });
});

// --- buildSynonymMap ---

describe('buildSynonymMap', () => {
  it('builds bidirectional mappings', () => {
    const map = buildSynonymMap({ license: ['permit', 'certificate'] });
    expect(map['license']).toContain('permit');
    expect(map['license']).toContain('certificate');
    expect(map['permit']).toContain('license');
    expect(map['certificate']).toContain('license');
  });

  it('handles multiple keys sharing a value', () => {
    const map = buildSynonymMap({
      tax: ['levy'],
      duty: ['levy'],
    });
    expect(map['levy']).toContain('tax');
    expect(map['levy']).toContain('duty');
  });

  it('returns empty object for empty input', () => {
    expect(buildSynonymMap({})).toEqual({});
  });
});

// --- fuzzySearch ---

const sampleServices: ServiceBase[] = [
  { id: '1', title: 'Business License', category: 'Licensing', overview: 'Register your business' },
  { id: '2', title: 'Tax Clearance', category: 'Tax', overview: 'Get tax clearance certificate' },
  { id: '3', title: 'Import Permit', category: 'Trade', overview: 'Apply for import permit' },
] as ServiceBase[];

describe('fuzzySearch', () => {
  const synonymMap = buildSynonymMap({ license: ['permit'] });

  it('finds exact substring match in title', () => {
    const results = fuzzySearch('business', sampleServices, synonymMap);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('finds match via synonym expansion', () => {
    // "license" expands to "permit" via synonymMap, so Import Permit should match too
    const results = fuzzySearch('license', sampleServices, synonymMap);
    expect(results.some((s) => s.id === '1')).toBe(true); // direct match
    expect(results.some((s) => s.id === '3')).toBe(true); // synonym match
  });

  it('matches against overview text', () => {
    const results = fuzzySearch('clearance certificate', sampleServices, {});
    expect(results.some((s) => s.id === '2')).toBe(true);
  });

  it('returns empty array when nothing matches', () => {
    const results = fuzzySearch('zzznotfound', sampleServices, {});
    expect(results).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const results = fuzzySearch('BUSINESS LICENSE', sampleServices, synonymMap);
    expect(results.some((s) => s.id === '1')).toBe(true);
  });
});
