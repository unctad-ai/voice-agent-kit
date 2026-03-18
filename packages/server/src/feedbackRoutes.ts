import { Router, type Router as RouterType } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

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
  userAgent?: string;
  timestamp: number;
}

export function createFeedbackRoutes(dataDir: string): { router: RouterType } {
  const router = Router();
  const feedbackDir = path.join(dataDir, 'feedback');

  // Ensure directory exists
  fs.mkdir(feedbackDir, { recursive: true }).catch(() => {});

  router.post('/', async (req, res) => {
    try {
      const entry: FeedbackEntry = {
        ...req.body,
        timestamp: Date.now(),
        userAgent: req.headers['user-agent'] || '',
      };
      const filename = `${entry.timestamp}-${entry.sessionId || 'unknown'}-${entry.turnNumber ?? 0}.json`;
      await fs.writeFile(path.join(feedbackDir, filename), JSON.stringify(entry, null, 2));
      res.status(201).json({ ok: true });
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
