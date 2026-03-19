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
      const ticketId = generateTicketId(timestamp, sessionId, turnNumber);

      const entry: FeedbackEntry = {
        ...req.body,
        ...(kitVersion ? { kitVersion } : {}),
        timestamp,
        userAgent: req.headers['user-agent'] || '',
        ticketId,
        status: 'new',
      };
      const filename = `${ticketId}.json`;
      await fs.writeFile(path.join(feedbackDir, filename), JSON.stringify(entry, null, 2));
      res.status(201).json({ ok: true, ticketId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const { sessionId, copilotName, from, to, limit = '50' } = req.query as Record<string, string>;
      const files = await fs.readdir(feedbackDir).catch(() => [] as string[]);
      let entries: FeedbackEntry[] = [];
      for (const file of files.filter(f => f.endsWith('.json')).sort().reverse()) {
        if (entries.length >= parseInt(limit)) break;
        const data = JSON.parse(await fs.readFile(path.join(feedbackDir, file), 'utf8'));
        if (sessionId && data.sessionId !== sessionId) continue;
        if (copilotName && data.copilotName !== copilotName) continue;
        if (from && data.timestamp < new Date(from).getTime()) continue;
        if (to && data.timestamp > new Date(to).getTime()) continue;
        entries.push(data);
      }
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read feedback' });
    }
  });

  return { router };
}
