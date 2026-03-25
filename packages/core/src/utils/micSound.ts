let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playTone(startHz: number, endHz: number, volume: number): void {
  if (prefersReducedMotion()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const duration = 0.1;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, now);
  osc.frequency.linearRampToValueAtTime(endHz, now + duration);

  const amp = Math.max(0, Math.min(1, volume)) * 0.15;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(amp, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

/** Rising tone — mic activated */
export function playMicOnSound(volume: number): void {
  playTone(440, 660, volume);
}

/** Falling tone — mic deactivated */
export function playMicOffSound(volume: number): void {
  playTone(660, 440, volume);
}
