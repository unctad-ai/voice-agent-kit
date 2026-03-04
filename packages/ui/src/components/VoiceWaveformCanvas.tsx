import { useRef, useEffect, useState } from 'react';
import {
  WAVEFORM_NUM_BARS,
  WAVEFORM_MIN_BAR_HEIGHT,
  WAVEFORM_MAX_BAR_HEIGHT,
  WAVEFORM_GAP,
  WAVEFORM_SMOOTHING,
} from '@voice-agent/core';
import type { OrbState } from '@voice-agent/core';

interface VoiceWaveformCanvasProps {
  analyserNode: AnalyserNode | null;
  state: OrbState;
  size: number;
}

const STATE_COLORS: Record<OrbState, [string, string]> = {
  idle: ['rgba(59,130,246,0.35)', 'rgba(96,165,250,0.12)'],
  listening: ['rgba(239,68,68,0.75)', 'rgba(251,191,36,0.3)'],
  processing: ['rgba(245,158,11,0.7)', 'rgba(251,191,36,0.3)'],
  speaking: ['rgba(34,197,94,0.7)', 'rgba(45,212,191,0.3)'],
  error: ['rgba(220,38,38,0.6)', 'rgba(153,27,27,0.25)'],
};

function lerpColor(a: string, b: string, t: number): string {
  // Parse rgba strings
  const parse = (s: string) => {
    const m = s.match(/[\d.]+/g);
    return m ? m.map(Number) : [0, 0, 0, 0];
  };
  const ca = parse(a);
  const cb = parse(b);
  const r = ca.map((v, i) => v + (cb[i] - v) * t);
  return `rgba(${Math.round(r[0])},${Math.round(r[1])},${Math.round(r[2])},${r[3].toFixed(3)})`;
}

export default function VoiceWaveformCanvas({
  analyserNode,
  state,
  size,
}: VoiceWaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const barsRef = useRef<Float32Array>(new Float32Array(WAVEFORM_NUM_BARS));
  const colorRef = useRef({ inner: STATE_COLORS.idle[0], outer: STATE_COLORS.idle[1] });

  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const freqData = analyserNode ? new Uint8Array(analyserNode.frequencyBinCount) : null;

    const tick = () => {
      ctx.clearRect(0, 0, size, size);

      // Lerp colors toward target state
      const target = STATE_COLORS[state];
      colorRef.current.inner = lerpColor(colorRef.current.inner, target[0], WAVEFORM_SMOOTHING);
      colorRef.current.outer = lerpColor(colorRef.current.outer, target[1], WAVEFORM_SMOOTHING);

      // Get frequency data
      if (analyserNode && freqData) {
        analyserNode.getByteFrequencyData(freqData);
      }

      const cx = size / 2;
      const cy = size / 2;
      const baseRadius = size * 0.35 + WAVEFORM_GAP;
      const baseBarWidth = Math.max(1.5, ((2 * Math.PI * baseRadius) / WAVEFORM_NUM_BARS) * 0.55);

      for (let i = 0; i < WAVEFORM_NUM_BARS; i++) {
        // Map frequency bin to target height
        let targetVal = 0;
        if (freqData && freqData.length > 0) {
          const binIndex = Math.floor((i / WAVEFORM_NUM_BARS) * freqData.length);
          targetVal = freqData[binIndex] / 255;
        }

        // Smooth interpolation
        barsRef.current[i] += (targetVal - barsRef.current[i]) * WAVEFORM_SMOOTHING;

        const effectiveMax = reducedMotion ? WAVEFORM_MIN_BAR_HEIGHT + 5 : WAVEFORM_MAX_BAR_HEIGHT;
        const barHeight =
          WAVEFORM_MIN_BAR_HEIGHT + barsRef.current[i] * (effectiveMax - WAVEFORM_MIN_BAR_HEIGHT);

        const angle = (i / WAVEFORM_NUM_BARS) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(angle) * baseRadius;
        const y1 = cy + Math.sin(angle) * baseRadius;
        const x2 = cx + Math.cos(angle) * (baseRadius + barHeight);
        const y2 = cy + Math.sin(angle) * (baseRadius + barHeight);

        // Draw bar with gradient
        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, colorRef.current.inner);
        gradient.addColorStop(1, colorRef.current.outer);

        // Bars thicken with amplitude for a more alive feel
        const barWidth = baseBarWidth + barsRef.current[i] * baseBarWidth * 0.6;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = barWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyserNode, state, size, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
