import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { PersonaStore } from './personaStore.js';

export interface PersonaRoutesOptions {
  personaDir: string;
  ttsUpstreamUrl?: string;
  /** Reuse an existing PersonaStore instead of creating a new one. */
  store?: PersonaStore;
}

export function createPersonaRoutes(options: PersonaRoutesOptions): { router: Router; store: PersonaStore } {
  const router = Router();
  const store = options.store ?? new PersonaStore(options.personaDir);
  const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

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

  // GET /persona — avatar inlined as data URI to avoid auth issues with <img src>
  router.get('/persona', (_req, res) => {
    const data = store.get();
    res.json({
      copilotName: data.copilotName,
      avatarUrl: getAvatarDataUri(),
      activeVoiceId: data.activeVoiceId,
      voices: data.voices.map(v => ({ id: v.id, name: v.name, filename: v.filename })),
    });
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

  // PUT /persona
  router.put('/persona', async (req, res) => {
    try {
      const { copilotName, activeVoiceId } = req.body;
      const updated = await store.update({ copilotName, activeVoiceId });
      res.json({
        copilotName: updated.copilotName,
        avatarUrl: getAvatarDataUri(),
        activeVoiceId: updated.activeVoiceId,
        voices: updated.voices.map(v => ({ id: v.id, name: v.name, filename: v.filename })),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update persona' });
    }
  });

  // POST /avatar (2MB limit)
  const avatarUpload = multer({ limits: { fileSize: 2 * 1024 * 1024 } });
  router.post('/avatar', avatarUpload.single('image'), async (req, res) => {
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
      res.status(500).json({ error: 'Failed to process avatar' });
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

  // POST /voices
  router.post('/voices', upload.single('audio'), async (req, res) => {
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
          if (durationSec > 30) {
            res.status(400).json({ error: `Voice sample too long (${Math.round(durationSec)}s). Maximum is 30 seconds.` });
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

  // DELETE /voices/:id
  router.delete('/voices/:id', async (req, res) => {
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
