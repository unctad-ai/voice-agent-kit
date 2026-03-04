import { useRef, useEffect, useCallback, useState } from 'react';
import { createNoise3D } from 'simplex-noise';
import { ORB_NUM_POINTS, ORB_LERP_SPEED, useSiteConfig } from '@voice-agent/core';
import type { OrbState } from '@voice-agent/core';

interface VoiceOrbProps {
  state: OrbState;
  /** Getter function called each animation frame — avoids 60fps React re-renders */
  getAmplitude: () => number;
  size?: number;
}

// ---------- state config ----------

interface StateConfig {
  colors: [string, string];
  noiseSpeed: number;
  noiseMag: number;
  baseScale: number;
  breathAmp: number;
  breathSpeed: number;
  rotation: number;
  shimmer: boolean;
}

/** Glow color that pulses around the orb per state */
const STATE_GLOW: Record<OrbState, string> = {
  idle: 'rgba(59, 130, 246, 0.25)',
  listening: 'rgba(219, 33, 41, 0.45)',
  processing: 'rgba(245, 158, 11, 0.4)',
  speaking: 'rgba(20, 184, 166, 0.4)',
  error: 'rgba(220, 38, 38, 0.4)',
};

function buildStateConfig(primaryColor: string): Record<OrbState, StateConfig> {
  return {
    idle: {
      colors: ['#1E3A5F', '#3B82F6'],
      noiseSpeed: 0.3,
      noiseMag: 8,
      baseScale: 0.975,
      breathAmp: 0.025,
      breathSpeed: 0.25,
      rotation: 0,
      shimmer: false,
    },
    listening: {
      colors: [primaryColor, '#F59E0B'],
      noiseSpeed: 0.6,
      noiseMag: 18,
      baseScale: 1.0,
      breathAmp: 0.04,
      breathSpeed: 0.5,
      rotation: 0,
      shimmer: false,
    },
    processing: {
      colors: ['#D97706', '#FBBF24'],
      noiseSpeed: 1.0,
      noiseMag: 14,
      baseScale: 1.0,
      breathAmp: 0.02,
      breathSpeed: 0.8,
      rotation: 0.4,
      shimmer: true,
    },
    speaking: {
      colors: ['#1B7A50', '#2DD4BF'],
      noiseSpeed: 0.5,
      noiseMag: 16,
      baseScale: 1.0,
      breathAmp: 0.05,
      breathSpeed: 0.4,
      rotation: 0,
      shimmer: false,
    },
    error: {
      colors: ['#DC2626', '#991B1B'],
      noiseSpeed: 1.4,
      noiseMag: 22,
      baseScale: 0.95,
      breathAmp: 0.01,
      breathSpeed: 1.2,
      rotation: 0,
      shimmer: false,
    },
  };
}

const NUM_POINTS = ORB_NUM_POINTS;
const LERP_SPEED = ORB_LERP_SPEED;

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return reduced;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpColor(a: string, b: string, t: number): string {
  const parseHex = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const ca = parseHex(a);
  const cb = parseHex(b);
  const r = Math.round(lerp(ca[0], cb[0], t));
  const g = Math.round(lerp(ca[1], cb[1], t));
  const bl = Math.round(lerp(ca[2], cb[2], t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export default function VoiceOrb({ state, getAmplitude, size = 200 }: VoiceOrbProps) {
  const config = useSiteConfig();
  const STATE_CONFIG = buildStateConfig(config.colors.primary);

  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);
  const noise3D = useRef(createNoise3D());
  const prefersReduced = useReducedMotion();
  const reducedRef = useRef(prefersReduced);
  reducedRef.current = prefersReduced;

  // Animated (lerped) config values that transition smoothly between states
  const animRef = useRef({
    noiseSpeed: STATE_CONFIG.idle.noiseSpeed,
    noiseMag: STATE_CONFIG.idle.noiseMag,
    baseScale: STATE_CONFIG.idle.baseScale,
    breathAmp: STATE_CONFIG.idle.breathAmp,
    breathSpeed: STATE_CONFIG.idle.breathSpeed,
    rotation: STATE_CONFIG.idle.rotation,
    color0: STATE_CONFIG.idle.colors[0],
    color1: STATE_CONFIG.idle.colors[1],
    shimmer: 0,
    errorShake: 0,
  });

  const stateRef = useRef<OrbState>(state);
  stateRef.current = state;

  const getAmplitudeRef = useRef(getAmplitude);
  getAmplitudeRef.current = getAmplitude;

  const stateConfigRef = useRef(STATE_CONFIG);
  stateConfigRef.current = STATE_CONFIG;

  const buildPath = useCallback(
    (time: number, a: typeof animRef.current): string => {
      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.35;
      const amp = getAmplitudeRef.current();

      // amplitude influences noise magnitude
      const mag = a.noiseMag + amp * 20;

      const points: [number, number][] = [];
      for (let i = 0; i < NUM_POINTS; i++) {
        const angle = (i / NUM_POINTS) * Math.PI * 2;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        const noiseVal = noise3D.current(nx * 1.5, ny * 1.5, time * a.noiseSpeed);
        const r = baseR + noiseVal * mag;
        points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      }

      // Build smooth closed path with cubic beziers
      let d = `M ${points[0][0]},${points[0][1]} `;
      for (let i = 0; i < NUM_POINTS; i++) {
        const curr = points[i];
        const next = points[(i + 1) % NUM_POINTS];
        const prev = points[(i - 1 + NUM_POINTS) % NUM_POINTS];
        const next2 = points[(i + 2) % NUM_POINTS];

        const cp1x = curr[0] + (next[0] - prev[0]) / 6;
        const cp1y = curr[1] + (next[1] - prev[1]) / 6;
        const cp2x = next[0] - (next2[0] - curr[0]) / 6;
        const cp2y = next[1] - (next2[1] - curr[1]) / 6;

        d += `C ${cp1x},${cp1y} ${cp2x},${cp2y} ${next[0]},${next[1]} `;
      }
      d += 'Z';
      return d;
    },
    [size]
  );

  useEffect(() => {
    let startTime: number | null = null;

    const tick = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = (timestamp - startTime) / 1000;

      const target = stateConfigRef.current[stateRef.current];
      const a = animRef.current;

      // When prefers-reduced-motion is active, dampen animations significantly
      const rd = reducedRef.current ? 0.15 : 1;

      // Lerp all animated values toward target
      a.noiseSpeed = lerp(a.noiseSpeed, target.noiseSpeed * rd, LERP_SPEED);
      a.noiseMag = lerp(a.noiseMag, target.noiseMag * rd, LERP_SPEED);
      a.baseScale = lerp(a.baseScale, target.baseScale, LERP_SPEED);
      a.breathAmp = lerp(a.breathAmp, target.breathAmp * rd, LERP_SPEED);
      a.breathSpeed = lerp(a.breathSpeed, target.breathSpeed * rd, LERP_SPEED);
      a.rotation = lerp(a.rotation, target.rotation * rd, LERP_SPEED);
      a.shimmer = lerp(a.shimmer, target.shimmer ? (reducedRef.current ? 0 : 1) : 0, LERP_SPEED);
      a.color0 = lerpColor(a.color0, target.colors[0], LERP_SPEED);
      a.color1 = lerpColor(a.color1, target.colors[1], LERP_SPEED);

      // Error shake decays
      if (stateRef.current === 'error') {
        a.errorShake = lerp(a.errorShake, 1, 0.1);
      } else {
        a.errorShake = lerp(a.errorShake, 0, 0.08);
      }

      const svg = svgRef.current;
      if (!svg) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Breathing scale
      const breath = a.baseScale + Math.sin(elapsed * Math.PI * 2 * a.breathSpeed) * a.breathAmp;

      // Error shake offset
      const shakeX = a.errorShake * Math.sin(elapsed * 30) * 3 * (1 - Math.min(elapsed * 0.3, 1));

      // Rotation
      const rot = elapsed * a.rotation * 360;

      // Update transform
      const group = svg.querySelector<SVGGElement>('[data-orb-group]');
      if (group) {
        group.setAttribute(
          'transform',
          `translate(${size / 2 + shakeX}, ${size / 2}) scale(${breath}) rotate(${rot}) translate(${-size / 2}, ${-size / 2})`
        );
      }

      // Update blob path
      const path = svg.querySelector<SVGPathElement>('[data-orb-path]');
      if (path) {
        path.setAttribute('d', buildPath(elapsed, a));
      }

      // Update gradient colors
      const stop0 = svg.querySelector<SVGStopElement>('[data-stop-0]');
      const stop1 = svg.querySelector<SVGStopElement>('[data-stop-1]');
      if (stop0) stop0.setAttribute('stop-color', a.color0);
      if (stop1) stop1.setAttribute('stop-color', a.color1);

      // Shimmer opacity
      const shimmerEl = svg.querySelector<SVGCircleElement>('[data-shimmer]');
      if (shimmerEl) {
        const shimmerOpacity = a.shimmer * (0.15 + Math.sin(elapsed * 6) * 0.1);
        shimmerEl.setAttribute('opacity', String(shimmerOpacity));
      }

      // Ambient glow — color follows state, opacity pulses with breath
      const glowEl = svg.querySelector<SVGCircleElement>('[data-orb-glow]');
      if (glowEl) {
        const amp = getAmplitudeRef.current();
        const glowPulse = 0.35 + Math.sin(elapsed * Math.PI * 2 * a.breathSpeed) * 0.15 + amp * 0.3;
        glowEl.setAttribute('opacity', String(Math.min(glowPulse, 1)));
        glowEl.setAttribute('fill', STATE_GLOW[stateRef.current]);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size, buildPath]);

  const idRef = useRef<string>(null);
  idRef.current ??= Math.random().toString(36).slice(2, 8);
  const gradientId = `orb-gradient-${idRef.current}`;
  const shimmerId = `orb-shimmer-${idRef.current}`;
  const glowFilterId = `orb-glow-${idRef.current}`;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="select-none"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={gradientId} cx="40%" cy="35%" r="60%">
          <stop data-stop-0 offset="0%" stopColor={STATE_CONFIG.idle.colors[0]} />
          <stop data-stop-1 offset="100%" stopColor={STATE_CONFIG.idle.colors[1]} />
        </radialGradient>
        <radialGradient id={shimmerId} cx="30%" cy="30%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity="0.6" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <filter id={glowFilterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="18" />
        </filter>
      </defs>
      {/* Ambient glow halo behind the orb */}
      <circle
        data-orb-glow
        cx={size / 2}
        cy={size / 2}
        r={size * 0.38}
        fill={STATE_GLOW.idle}
        opacity="0.5"
        filter={`url(#${glowFilterId})`}
      />
      <g data-orb-group>
        <path data-orb-path fill={`url(#${gradientId})`} />
        <circle
          data-shimmer
          cx={size / 2}
          cy={size / 2}
          r={size * 0.3}
          fill={`url(#${shimmerId})`}
          opacity="0"
        />
      </g>
    </svg>
  );
}
