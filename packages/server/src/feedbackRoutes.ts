import { Router, type Router as RouterType } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

export function generateTicketId(timestamp: number, sessionId: string, turnNumber: number): string {
  const input = `${timestamp}-${sessionId}-${turnNumber}`;
  let hash = 0;
  for (const ch of input) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const abs = Math.abs(hash);
  return 'FB-' + Array.from({ length: 4 }, (_, i) =>
    chars[(abs >> (i * 5)) & 31]
  ).join('');
}

export interface FeedbackEntry {
  sessionId: string;
  turnNumber?: number;
  text: string;
  assistantMessage?: string;
  userMessage?: string;
  toolCalls?: string[];
  timings?: Record<string, number>;
  route?: string;
  copilotName?: string;
  kitVersion?: string;
  userAgent?: string;
  timestamp: number;
  ticketId: string;
  status: 'new' | 'triaged' | 'dismissed' | 'confirmed' | 'fixed';
  rootCause?: string;
  notes?: string;
  updatedAt?: number;
}

export function createFeedbackRoutes(dataDir: string, kitVersion?: string): { router: RouterType } {
  const router = Router();
  const feedbackDir = path.join(dataDir, 'feedback');

  // Ensure directory exists
  fs.mkdir(feedbackDir, { recursive: true }).catch(() => {});

  router.post('/', async (req, res) => {
    try {
      const timestamp = Date.now();
      const sessionId = req.body.sessionId || 'unknown';
      const turnNumber = req.body.turnNumber ?? 0;
      let ticketId = generateTicketId(timestamp, sessionId, turnNumber);

      // Collision guard: if file already exists, rehash with shifted timestamp
      let filePath = path.join(feedbackDir, `${ticketId}.json`);
      let collided = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { await fs.access(filePath); } catch { break; } // file doesn't exist — use this ID
        collided = true;
        ticketId = generateTicketId(timestamp + attempt + 1, sessionId, turnNumber);
        filePath = path.join(feedbackDir, `${ticketId}.json`);
      }
      // If still colliding after retries, bail
      if (collided) {
        try { await fs.access(filePath); return res.status(409).json({ error: 'Ticket ID collision, please retry' }); } catch { /* good */ }
      }

      const entry: FeedbackEntry = {
        ...req.body,
        ...(kitVersion ? { kitVersion } : {}),
        timestamp,
        userAgent: req.headers['user-agent'] || '',
        ticketId,
        status: 'new',
      };
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
      res.status(201).json({ ok: true, ticketId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const { sessionId, copilotName, from, to, limit = '50', status } = req.query as Record<string, string>;
      const files = await fs.readdir(feedbackDir).catch(() => [] as string[]);
      let entries: FeedbackEntry[] = [];
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const data = JSON.parse(await fs.readFile(path.join(feedbackDir, file), 'utf8'));
        // v1 migration: derive missing ticketId and default status
        if (!data.ticketId) {
          data.ticketId = generateTicketId(data.timestamp, data.sessionId || 'unknown', data.turnNumber ?? 0);
          data.status = data.status || 'new';
        }
        if (!data.status) data.status = 'new';
        if (sessionId && data.sessionId !== sessionId) continue;
        if (copilotName && data.copilotName !== copilotName) continue;
        if (from && data.timestamp < new Date(from).getTime()) continue;
        if (to && data.timestamp > new Date(to).getTime()) continue;
        if (status && data.status !== status) continue;
        entries.push(data);
      }
      // Sort by timestamp descending (can't rely on filename order with ticketId filenames)
      entries.sort((a, b) => b.timestamp - a.timestamp);
      entries = entries.slice(0, parseInt(limit));
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read feedback' });
    }
  });

  router.get('/:ticketId', async (req, res) => {
    const { ticketId } = req.params;
    const filePath = path.join(feedbackDir, `${ticketId}.json`);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      res.json(data);
    } catch {
      // Try scanning for v1 files
      try {
        const files = await fs.readdir(feedbackDir);
        for (const file of files.filter(f => f.endsWith('.json'))) {
          const data = JSON.parse(await fs.readFile(path.join(feedbackDir, file), 'utf8'));
          const derived = data.ticketId || generateTicketId(data.timestamp, data.sessionId || 'unknown', data.turnNumber ?? 0);
          if (derived === ticketId) {
            if (!data.ticketId) { data.ticketId = derived; data.status = data.status || 'new'; }
            res.json(data);
            return;
          }
        }
      } catch { /* directory may not exist */ }
      res.status(404).json({ error: 'Feedback not found' });
    }
  });

  const VALID_STATUSES = new Set(['new', 'triaged', 'dismissed', 'confirmed', 'fixed']);

  router.patch('/:ticketId', async (req, res) => {
    const { ticketId } = req.params;
    const { status, rootCause, notes } = req.body;
    if (status && !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }
    if (notes && notes.length > 2000) {
      return res.status(400).json({ error: 'Notes must be 2000 characters or fewer' });
    }
    const filePath = path.join(feedbackDir, `${ticketId}.json`);
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (status) data.status = status;
      if (rootCause !== undefined) data.rootCause = rootCause;
      if (notes !== undefined) data.notes = notes;
      data.updatedAt = Date.now();
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      res.json({ ok: true, ticketId, status: data.status });
    } catch {
      res.status(404).json({ error: 'Feedback not found' });
    }
  });

  return { router };
}
