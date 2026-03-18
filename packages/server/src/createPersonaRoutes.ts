import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { PersonaStore } from './personaStore.js';

export interface PersonaRoutesOptions {
  personaDir: string;
  ttsUpstreamUrl?: string;
  /** Reuse an existing PersonaStore instead of creating a new one. */
  store?: PersonaStore;
  /** Admin password for shared settings mutations. Default: 'admin'. */
  adminPassword?: string;
  /** Broadcast an event to all connected WebSocket clients. */
  broadcast?: (event: Record<string, unknown>) => void;
}

export function createPersonaRoutes(options: PersonaRoutesOptions): { router: Router; store: PersonaStore } {
  const router = Router();
  const store = options.store ?? new PersonaStore(options.personaDir);
  const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

  const password = options.adminPassword ?? 'admin';

  function requireAdmin(req: Request, res: Response): boolean {
    const provided = req.headers['x-admin-password'] as string | undefined;
    if (!provided) {
      res.status(401).json({ error: 'Admin password required' });
      return false;
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(password);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Invalid admin password' });
      return false;
    }
    return true;
  }

  // Sync local voice list with TTS server on startup — remove stale entries
  if (options.ttsUpstreamUrl) {
    const url = options.ttsUpstreamUrl;
    fetch(`${url}/voices`).then(r => r.json()).then(async (res: { voices: string[] }) => {
      const remote = new Set(res.voices);
      const data = store.get();
      const stale = data.voices.filter(v => !remote.has(v.id));
      for (const v of stale) {
        console.log(`[Persona] removing stale voice: ${v.id} (not on TTS server)`);
        const wavPath = path.join(store.getVoicesDir(), v.filename);
        if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
        await store.removeVoice(v.id);
      }
      if (stale.length) console.log(`[Persona] synced voices with TTS server (removed ${stale.length} stale)`);
    }).catch(err => {
      console.warn('[Persona] TTS voice sync failed:', err.message);
    });
  }

  // GET /config — merged config with avatar inlined as data URI
  router.get('/config', (_req, res) => {
    const config = store.getFullConfig();
    res.json({ ...config, avatarUrl: getAvatarDataUri() });
  });

  // Helper: read avatar as data URI
  function getAvatarDataUri(): string {
    const avatarPath = store.getAvatarPath();
    if (avatarPath && fs.existsSync(avatarPath)) {
      const mime = avatarPath.endsWith('.webp') ? 'image/webp' : 'image/png';
      return `data:${mime};base64,${fs.readFileSync(avatarPath).toString('base64')}`;
    }
    return '';
  }

  // PUT /config (admin-gated)
  router.put('/config', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { copilotName, activeVoiceId, copilotColor, siteTitle,
              greetingMessage, farewellMessage, systemPromptIntro, language } = req.body;
      await store.update({
        ...(copilotName !== undefined && { copilotName }),
        ...(activeVoiceId !== undefined && { activeVoiceId }),
        ...(copilotColor !== undefined && { copilotColor }),
        ...(siteTitle !== undefined && { siteTitle }),
        ...(greetingMessage !== undefined && { greetingMessage }),
        ...(farewellMessage !== undefined && { farewellMessage }),
        ...(systemPromptIntro !== undefined && { systemPromptIntro }),
        ...(language !== undefined && { language }),
      });
      const config = store.getFullConfig();
      options.broadcast?.({ type: 'config.updated', config });
      res.json({ ...config, avatarUrl: getAvatarDataUri() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  // POST /avatar (admin-gated)
  const avatarUpload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });
  router.post('/avatar', (req, res, next) => {
    avatarUpload.single('image')(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image too large (max 5MB)' });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  }, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No image file provided' });
        return;
      }
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowed.includes(req.file.mimetype)) {
        res.status(400).json({ error: 'Image must be PNG, JPG, or WebP' });
        return;
      }
      const outPath = path.join(options.personaDir, 'avatar.webp');
      await sharp(req.file.buffer)
        .resize(128, 128, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(outPath);
      await store.setAvatar('avatar.webp');
      res.json({ avatarUrl: getAvatarDataUri() });
    } catch (err) {
      console.error('[Persona] avatar upload error:', err);
      res.status(400).json({ error: 'Could not read image — try a different file' });
    }
  });

  // GET /avatar
  router.get('/avatar', (req, res) => {
    const avatarPath = store.getAvatarPath();
    if (!avatarPath) {
      res.status(404).json({ error: 'No avatar set' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.resolve(avatarPath));
  });

  // GET /voices
  router.get('/voices', (req, res) => {
    const data = store.get();
    res.json({
      voices: data.voices.map(v => ({ id: v.id, name: v.name, filename: v.filename })),
      activeVoiceId: data.activeVoiceId,
    });
  });

  // POST /voices (admin-gated)
  router.post('/voices', upload.single('audio'), async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No audio file provided' });
        return;
      }
      const name = req.body.name;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Voice name is required' });
        return;
      }
      const data = store.get();
      if (data.voices.length >= 10) {
        res.status(409).json({ error: 'Maximum 10 voices allowed' });
        return;
      }
      const buf = req.file.buffer;
      if (buf.length >= 44) {
        const sampleRate = buf.readUInt32LE(24);
        const bitsPerSample = buf.readUInt16LE(34);
        const channels = buf.readUInt16LE(22);
        const dataSize = buf.readUInt32LE(40);
        if (sampleRate > 0 && bitsPerSample > 0 && channels > 0) {
          const durationSec = dataSize / (sampleRate * channels * (bitsPerSample / 8));
          if (durationSec > 45) {
            res.status(400).json({ error: `Voice sample too long (${Math.round(durationSec)}s). Maximum is 45 seconds.` });
            return;
          }
        }
      }

      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
      const filename = `${id}.wav`;
      const wavPath = path.join(store.getVoicesDir(), filename);
      fs.writeFileSync(wavPath, req.file.buffer);

      if (options.ttsUpstreamUrl) {
        const form = new FormData();
        form.append('voice_id', id);
        form.append('audio', new Blob([new Uint8Array(req.file.buffer)]), filename);
        const ttsRes = await fetch(`${options.ttsUpstreamUrl}/voices`, {
          method: 'POST',
          body: form,
        });
        if (!ttsRes.ok) {
          fs.unlinkSync(wavPath);
          const err = await ttsRes.text();
          res.status(502).json({ error: `TTS voice caching failed: ${err}` });
          return;
        }
      }

      await store.addVoice({ id, name, filename });
      res.json({ id, name, filename, status: 'cached' });
    } catch (err) {
      console.error('[Persona] voice upload error:', err);
      res.status(500).json({ error: 'Failed to upload voice' });
    }
  });

  // DELETE /voices/:id (admin-gated)
  router.delete('/voices/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { id } = req.params;
      const data = store.get();
      const voice = data.voices.find(v => v.id === id);
      if (!voice) {
        res.status(404).json({ error: 'Voice not found' });
        return;
      }
      if (options.ttsUpstreamUrl) {
        await fetch(`${options.ttsUpstreamUrl}/voices/${id}`, { method: 'DELETE' }).catch(() => {});
      }
      const wavPath = path.join(store.getVoicesDir(), voice.filename);
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
      await store.removeVoice(id);
      res.status(204).end();
    } catch (err) {
      console.error('[Persona] voice delete error:', err);
      res.status(500).json({ error: 'Failed to delete voice' });
    }
  });

  // POST /voices/:id/preview
  router.post('/voices/:id/preview', async (req, res) => {
    try {
      const { id } = req.params;
      const { text } = req.body;
      if (!text) {
        res.status(400).json({ error: 'Text is required' });
        return;
      }
      if (!options.ttsUpstreamUrl) {
        res.status(501).json({ error: 'TTS upstream not configured' });
        return;
      }
      const form = new URLSearchParams();
      form.append('text', text);
      form.append('voice', id);
      const ttsRes = await fetch(`${options.ttsUpstreamUrl}/tts-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!ttsRes.ok) {
        res.status(502).json({ error: 'TTS preview failed' });
        return;
      }
      res.setHeader('Content-Type', 'audio/wav');
      const reader = ttsRes.body?.getReader();
      if (!reader) { res.status(500).end(); return; }
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      console.error('[Persona] voice preview error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Preview failed' });
      else res.end();
    }
  });

  return { router, store };
}
