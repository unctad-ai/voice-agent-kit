import { describe, it, expect } from 'vitest';
import { summarizeToolResult } from '../utils/summarizeToolResult';

describe('summarizeToolResult', () => {
  // --- getFormSchema ---
  describe('getFormSchema', () => {
    it('summarizes sections and field count', () => {
      const result = JSON.stringify({
        sections: [
          { section: 'Capacity', fields: ['a', 'b', 'c'] },
          { section: 'General Info', fields: ['d'] },
        ],
      });
      expect(summarizeToolResult('getFormSchema', result)).toBe(
        '4 fields in Capacity, General Info',
      );
    });

    it('handles sections with no names', () => {
      const result = JSON.stringify({
        sections: [{ fields: ['a', 'b'] }],
      });
      expect(summarizeToolResult('getFormSchema', result)).toBe('2 fields');
    });

    it('handles empty sections array', () => {
      const result = JSON.stringify({ sections: [] });
      expect(summarizeToolResult('getFormSchema', result)).toBe('0 fields');
    });
  });

  // --- fillFormFields ---
  describe('fillFormFields', () => {
    it('shows filled count', () => {
      const result = JSON.stringify({ filled: ['a', 'b', 'c'], skipped: [] });
      expect(summarizeToolResult('fillFormFields', result)).toBe('3 fields filled');
    });

    it('singular when 1 field', () => {
      const result = JSON.stringify({ filled: ['a'], skipped: [] });
      expect(summarizeToolResult('fillFormFields', result)).toBe('1 field filled');
    });

    it('shows filled and skipped', () => {
      const result = JSON.stringify({ filled: ['a', 'b'], skipped: ['c'] });
      expect(summarizeToolResult('fillFormFields', result)).toBe('2 filled, 1 skipped');
    });
  });

  // --- searchServices / listServicesByCategory ---
  describe('searchServices', () => {
    it('shows service count', () => {
      const result = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(summarizeToolResult('searchServices', result)).toBe('3 services found');
    });

    it('singular when 1 service', () => {
      const result = JSON.stringify([{ id: 1 }]);
      expect(summarizeToolResult('searchServices', result)).toBe('1 service found');
    });

    it('works for listServicesByCategory too', () => {
      const result = JSON.stringify([{ id: 1 }, { id: 2 }]);
      expect(summarizeToolResult('listServicesByCategory', result)).toBe('2 services found');
    });
  });

  // --- getServiceDetails ---
  describe('getServiceDetails', () => {
    it('returns title', () => {
      const result = JSON.stringify({ title: 'Company Registration' });
      expect(summarizeToolResult('getServiceDetails', result)).toBe('Company Registration');
    });

    it('falls back to name', () => {
      const result = JSON.stringify({ name: 'Tax Filing' });
      expect(summarizeToolResult('getServiceDetails', result)).toBe('Tax Filing');
    });

    it('truncates long titles', () => {
      const result = JSON.stringify({ title: 'A'.repeat(50) });
      expect(summarizeToolResult('getServiceDetails', result)).toBe('A'.repeat(40));
    });
  });

  // --- navigation tools ---
  describe('navigation tools', () => {
    it('returns empty for navigateTo', () => {
      expect(summarizeToolResult('navigateTo', '"ok"')).toBe('');
    });

    it('returns empty for viewService', () => {
      expect(summarizeToolResult('viewService', '"done"')).toBe('');
    });

    it('returns empty for startApplication', () => {
      expect(summarizeToolResult('startApplication', '"started"')).toBe('');
    });
  });

  // --- performUIAction ---
  describe('performUIAction', () => {
    it('returns string result', () => {
      expect(summarizeToolResult('performUIAction', '"Switched to name tab"')).toBe(
        'Switched to name tab',
      );
    });

    it('returns empty for non-string result', () => {
      expect(summarizeToolResult('performUIAction', '{"success":true}')).toBe('');
    });
  });

  // --- fallback behavior ---
  describe('fallback', () => {
    it('suppresses raw JSON objects', () => {
      expect(summarizeToolResult('unknownTool', '{"foo":"bar"}')).toBe('');
    });

    it('suppresses raw JSON arrays', () => {
      expect(summarizeToolResult('unknownTool', '[1,2,3]')).toBe('');
    });

    it('passes through short plain text', () => {
      expect(summarizeToolResult('unknownTool', 'Done successfully')).toBe('Done successfully');
    });

    it('truncates long plain text at word boundary', () => {
      const long = 'This is a very long result that should be truncated at a word boundary here';
      const result = summarizeToolResult('unknownTool', long);
      expect(result.length).toBeLessThanOrEqual(41); // 40 + ellipsis
      expect(result).toMatch(/\u2026$/);
    });

    it('handles invalid JSON gracefully', () => {
      expect(summarizeToolResult('getFormSchema', '{broken json')).toBe('');
    });
  });
});
