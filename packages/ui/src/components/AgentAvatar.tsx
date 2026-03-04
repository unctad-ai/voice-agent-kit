import { useRef, useEffect, useState, useCallback } from 'react';
import VoiceOrb from './VoiceOrb';
import {
  AVATAR_PORTRAIT_RATIO,
  AVATAR_STATE_FILTERS,
  buildGlowColors,
  useSiteConfig,
} from '@voice-agent/core';
import type { OrbState } from '@voice-agent/core';

/** Conic gradient colors per state — [color1, color2] */
const RING_COLORS: Record<OrbState, [string, string]> = {
  idle: ['#93a3c8', '#b0bfdb'],
  listening: ['#DB2129', '#34d399'],
  processing: ['#F59E0B', '#FBBF24'],
  speaking: ['#14B8A6', '#34d399'],
  error: ['#DC2626', '#991B1B'],
};

interface AgentAvatarProps {
  state: OrbState;
  getAmplitude: () => number;
  size?: number;
  showAura?: boolean;
  /** Show audio-reactive conic-gradient ring around portrait */
  showRing?: boolean;
  /** URL for the avatar portrait image */
  portraitSrc?: string;
  /** Monogram letter shown when image fails to load */
  monogram?: string;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function AgentAvatar({
  state,
  getAmplitude,
  size = 36,
  showAura = true,
  showRing = false,
  portraitSrc,
  monogram,
}: AgentAvatarProps) {
  const config = useSiteConfig();
  const initial = monogram ?? config.copilotName?.charAt(0)?.toUpperCase() ?? 'A';
  const { colors } = useSiteConfig();
  const AVATAR_GLOW_COLORS = buildGlowColors(colors);
  const portraitSize = Math.round(size * AVATAR_PORTRAIT_RATIO);
  const offset = Math.round((size - portraitSize) / 2);

  // Ring sits between aura and portrait — 3px border around portrait
  const ringWidth = 3;
  const ringSize = portraitSize + ringWidth * 2;
  const ringOffset = Math.round((size - ringSize) / 2);

  const imgRef = useRef<HTMLImageElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef<OrbState>(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const getAmpRef = useRef(getAmplitude);
  useEffect(() => {
    getAmpRef.current = getAmplitude;
  });

  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  // Detect prefers-reduced-motion
  const reducedRef = useRef(false);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedRef.current = mql.matches;
    const handler = (e: MediaQueryListEvent) => {
      reducedRef.current = e.matches;
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Animated filter values — lerped each frame, no React re-renders
  const animRef = useRef({
    brightness: AVATAR_STATE_FILTERS.idle.brightness,
    saturate: AVATAR_STATE_FILTERS.idle.saturate,
    opacity: AVATAR_STATE_FILTERS.idle.opacity,
    scale: AVATAR_STATE_FILTERS.idle.scale,
    glowIntensity: AVATAR_STATE_FILTERS.idle.glowIntensity,
    ringAngle: 0,
  });

  useEffect(() => {
    let startTime: number | null = null;
    let prevTimestamp = 0;

    const tick = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = (timestamp - startTime) / 1000;
      const dt = prevTimestamp ? (timestamp - prevTimestamp) / 1000 : 0.016;
      prevTimestamp = timestamp;

      const target = AVATAR_STATE_FILTERS[stateRef.current];
      const a = animRef.current;
      const speed = 0.08;

      a.brightness = lerp(a.brightness, target.brightness, speed);
      a.saturate = lerp(a.saturate, target.saturate, speed);
      a.scale = lerp(a.scale, target.scale, speed);
      a.glowIntensity = lerp(a.glowIntensity, target.glowIntensity, speed);

      // Processing opacity pulses
      let targetOpacity = target.opacity;
      if (stateRef.current === 'processing') {
        targetOpacity = 0.92 + Math.sin(elapsed * 4) * 0.06;
      }
      a.opacity = lerp(a.opacity, targetOpacity, speed);

      // Speaking state: portrait scale reacts to amplitude
      const amp = getAmpRef.current();
      const ampFactor = reducedRef.current ? 0.2 : 1;
      let scaleBoost = 0;
      if (stateRef.current === 'speaking') {
        scaleBoost = amp * 0.03 * ampFactor;
      }

      // Apply to portrait image via direct DOM mutation
      const img = imgRef.current;
      if (img) {
        img.style.filter = `brightness(${a.brightness}) saturate(${a.saturate})`;
        img.style.opacity = String(a.opacity);
        img.style.transform = `scale(${a.scale + scaleBoost})`;
      }

      // Apply glow overlay
      const glow = glowRef.current;
      if (glow) {
        glow.style.backgroundColor = AVATAR_GLOW_COLORS[stateRef.current];
        glow.style.opacity = String(a.glowIntensity);
      }

      // Audio-reactive ring
      const ring = ringRef.current;
      if (ring) {
        const ringColors = RING_COLORS[stateRef.current];
        // Rotation: base 120 deg/s, amplitude boosts up to 3x
        const rotSpeed = reducedRef.current ? 0 : 120 * (1 + amp * 2);
        a.ringAngle = (a.ringAngle + rotSpeed * dt) % 360;
        // Ring opacity: idle = subtle, active states = brighter with amplitude boost
        const isActive = stateRef.current !== 'idle';
        const ringOpacity = isActive ? 0.7 + amp * 0.3 : 0.35;
        // Scale pulse with amplitude
        const ringScale = 1 + amp * 0.04 * ampFactor;

        ring.style.background = `conic-gradient(from ${a.ringAngle}deg, ${ringColors[0]}, ${ringColors[1]}, ${ringColors[0]})`;
        ring.style.opacity = String(ringOpacity);
        ring.style.transform = `scale(${ringScale})`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setErrored(true), []);

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {/* Layer 1: Aura — VoiceOrb as reactive background */}
      {showAura && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <VoiceOrb state={state} getAmplitude={getAmplitude} size={size} />
        </div>
      )}

      {/* Layer 1.5: Audio-reactive conic-gradient ring */}
      {showRing && (
        <div
          ref={ringRef}
          style={{
            position: 'absolute',
            top: ringOffset,
            left: ringOffset,
            width: ringSize,
            height: ringSize,
            borderRadius: '50%',
            background: `conic-gradient(from 0deg, ${RING_COLORS.idle[0]}, ${RING_COLORS.idle[1]}, ${RING_COLORS.idle[0]})`,
            opacity: 0.35,
            WebkitMask: `radial-gradient(circle, transparent ${Math.round((portraitSize / ringSize) * 50)}%, black ${Math.round((portraitSize / ringSize) * 50)}%)`,
            mask: `radial-gradient(circle, transparent ${Math.round((portraitSize / ringSize) * 50)}%, black ${Math.round((portraitSize / ringSize) * 50)}%)`,
            pointerEvents: 'none',
            willChange: 'transform, background, opacity',
          }}
        />
      )}

      {/* Layer 2: Glow overlay — color wash per state */}
      <div
        ref={glowRef}
        style={{
          position: 'absolute',
          top: offset,
          left: offset,
          width: portraitSize,
          height: portraitSize,
          borderRadius: '50%',
          mixBlendMode: 'soft-light',
          opacity: 0,
          pointerEvents: 'none',
          transition: 'background-color 0.3s',
        }}
      />

      {/* Layer 3: Portrait */}
      <div
        style={{
          position: 'absolute',
          top: offset,
          left: offset,
          width: portraitSize,
          height: portraitSize,
          borderRadius: '50%',
          overflow: 'hidden',
        }}
      >
        {errored || !portraitSrc ? (
          // Monogram fallback
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.primary,
              color: 'white',
              fontFamily: 'DM Sans, sans-serif',
              fontWeight: 700,
              fontSize: Math.round(portraitSize * 0.45),
            }}
          >
            {initial}
          </div>
        ) : (
          <img
            ref={imgRef}
            src={portraitSrc}
            alt="Avatar"
            onLoad={handleLoad}
            onError={handleError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '50%',
              opacity: loaded ? 0.95 : 0,
              transition: loaded ? 'none' : 'opacity 0.3s ease-in',
              willChange: 'filter, transform, opacity',
            }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
