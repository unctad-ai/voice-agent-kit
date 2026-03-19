import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFeedbackRoutes, generateTicketId } from '../feedbackRoutes.js';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

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

describe('POST /api/feedback', () => {
  let tmpDir: string;
  let feedbackDir: string;
  let listener: any;
  let port: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-'));
    feedbackDir = path.join(tmpDir, 'feedback');
    await fs.mkdir(feedbackDir, { recursive: true });
    const { router } = createFeedbackRoutes(tmpDir);
    const app = express().use(express.json()).use('/api/feedback', router);
    listener = app.listen(0);
    port = (listener.address() as any).port;
  });

  afterEach(async () => {
    listener.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns ticketId in response', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess1', turnNumber: 1, text: 'bad response' }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ticketId).toMatch(/^FB-[A-Z2-9]{4}$/);
  });

  it('saves file as {ticketId}.json with status new', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess1', turnNumber: 1, text: 'bad response' }),
    });
    const body = await res.json();
    const files = await fs.readdir(feedbackDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${body.ticketId}.json`);

    const stored = JSON.parse(await fs.readFile(path.join(feedbackDir, files[0]), 'utf8'));
    expect(stored.ticketId).toBe(body.ticketId);
    expect(stored.status).toBe('new');
  });
});
