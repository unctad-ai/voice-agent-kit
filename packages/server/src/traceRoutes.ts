import { Router, type Router as RouterType } from 'express';
import { promises as fs } from 'fs';
import path from 'path';

export function createTraceRoutes(dataDir: string): { router: RouterType } {
  const router = Router();
  const tracesDir = path.join(dataDir, 'traces');

  // List recent sessions (filenames + stat only, no file reads)
  router.get('/', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '20', 10);
      const files = await fs.readdir(tracesDir).catch(() => [] as string[]);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const sessions = await Promise.all(
        jsonFiles.map(async (f) => {
          const stat = await fs.stat(path.join(tracesDir, f));
          return {
            sessionId: f.replace('.json', ''),
            startedAt: stat.mtimeMs,
          };
        }),
      );

      sessions.sort((a, b) => b.startedAt - a.startedAt);
      res.json(sessions.slice(0, limit));
    } catch (err) {
      res.status(500).json({ error: 'Failed to list traces' });
    }
  });

  // Get single session trace
  router.get('/:sessionId', async (req, res) => {
    try {
      const sessionId = path.basename(req.params.sessionId);
      const filePath = path.join(tracesDir, `${sessionId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      res.json(JSON.parse(data));
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        res.status(404).json({ error: 'Trace not found' });
      } else {
        res.status(500).json({ error: 'Failed to read trace' });
      }
    }
  });

  return { router };
}
