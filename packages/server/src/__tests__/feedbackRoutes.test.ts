import { describe, it, expect } from 'vitest';
import { generateTicketId } from '../feedbackRoutes.js';

describe('generateTicketId', () => {
  it('returns FB- prefix with 4 chars', () => {
    const id = generateTicketId(1710693600000, 'abc123', 2);
    expect(id).toMatch(/^FB-[A-Z2-9]{4}$/);
  });

  it('is deterministic', () => {
    const a = generateTicketId(1710693600000, 'abc123', 2);
    const b = generateTicketId(1710693600000, 'abc123', 2);
    expect(a).toBe(b);
  });

  it('produces different IDs for different inputs', () => {
    const a = generateTicketId(1710693600000, 'abc123', 2);
    const b = generateTicketId(1710693600000, 'abc123', 3);
    expect(a).not.toBe(b);
  });

  it('excludes ambiguous chars (0, O, 1, I)', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateTicketId(Date.now() + i, `session${i}`, i);
      expect(id).not.toMatch(/[01OI]/);
    }
  });
});
