import { describe, it, expect } from 'vitest';
import { createEvent, parseEvent, isAudioFrame } from '../protocol.js';

describe('protocol', () => {
  describe('createEvent', () => {
    it('serializes a server event to JSON string', () => {
      const json = createEvent('session.created', { session_id: 'abc' });
      const parsed = JSON.parse(json);
      expect(parsed).toEqual({ type: 'session.created', session_id: 'abc' });
    });
    it('serializes event with no payload', () => {
      const json = createEvent('response.audio.done', {});
      expect(JSON.parse(json)).toEqual({ type: 'response.audio.done' });
    });
  });
  describe('parseEvent', () => {
    it('parses valid JSON client event', () => {
      const raw = JSON.stringify({ type: 'session.update', conversation: [] });
      const event = parseEvent(raw);
      expect(event).not.toBeNull();
      expect(event!.type).toBe('session.update');
    });
    it('returns null for invalid JSON', () => {
      expect(parseEvent('not json')).toBeNull();
    });
    it('returns null for missing type field', () => {
      expect(parseEvent(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });
  });
  describe('isAudioFrame', () => {
    it('returns true for Buffer with Float32 length', () => {
      expect(isAudioFrame(Buffer.alloc(7680))).toBe(true);
    });
    it('returns false for empty buffer', () => {
      expect(isAudioFrame(Buffer.alloc(0))).toBe(false);
    });
    it('returns false for non-multiple-of-4 length', () => {
      expect(isAudioFrame(Buffer.alloc(7))).toBe(false);
    });
  });
});
