import { useRef, useEffect, useState } from 'react';
import {
  DOT_RING_COUNT,
  DOT_RING_GAP,
  DOT_RING_BASE_RADIUS,
  DOT_RING_PEAK_RADIUS,
  DOT_RING_SMOOTHING,
} from '@unctad-ai/voice-agent-core';
import type { OrbState } from '@unctad-ai/voice-agent-core';

interface VoiceDotRingProps {
  analyserNode: AnalyserNode | null;
  state: OrbState;
  orbRadius: number;
}

const STATE_COLORS: Record<OrbState, string> = {
  idle: 'rgba(59,130,246,0.6)',
  listening: 'rgba(219,33,41,0.8)',
  processing: 'rgba(245,158,11,0.7)',
  speaking: 'rgba(34,197,94,0.7)',
  error: 'rgba(220,38,38,0.6)',
};

export default function VoiceDotRing({ analyserNode, state, orbRadius }: VoiceDotRingProps) {
  const dotsRef = useRef<(SVGCircleElement | null)[]>([]);
  const barsRef = useRef<Float32Array>(new Float32Array(DOT_RING_COUNT));
  const rafRef = useRef<number>(0);
  const colorRef = useRef(STATE_COLORS.idle);

  const [reducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const ringRadius = orbRadius + DOT_RING_GAP;
  const svgSize = (ringRadius + DOT_RING_PEAK_RADIUS + 2) * 2;
  const cx = svgSize / 2;
  const cy = svgSize / 2;

  useEffect(() => {
    const freqData = analyserNode ? new Uint8Array(analyserNode.frequencyBinCount) : null;

    const tick = () => {
      // Lerp color toward target
      colorRef.current = STATE_COLORS[state];

      if (analyserNode && freqData) {
        analyserNode.getByteFrequencyData(freqData);
      }

      for (let i = 0; i < DOT_RING_COUNT; i++) {
        const dot = dotsRef.current[i];
        if (!dot) continue;

        let targetVal = 0;
        if (freqData && freqData.length > 0) {
          const binIndex = Math.floor((i / DOT_RING_COUNT) * freqData.length);
          targetVal = freqData[binIndex] / 255;
        }

        barsRef.current[i] += (targetVal - barsRef.current[i]) * DOT_RING_SMOOTHING;

        const val = reducedMotion ? 0 : barsRef.current[i];
        const r = DOT_RING_BASE_RADIUS + val * (DOT_RING_PEAK_RADIUS - DOT_RING_BASE_RADIUS);
        const opacity = 0.3 + val * 0.5;

        dot.setAttribute('r', String(r));
        dot.setAttribute('opacity', String(opacity));
        dot.setAttribute('fill', colorRef.current);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyserNode, state, reducedMotion, ringRadius]);

  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className="absolute pointer-events-none"
      style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
      aria-hidden="true"
    >
      {Array.from({ length: DOT_RING_COUNT }, (_, i) => {
        const angle = (i / DOT_RING_COUNT) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * ringRadius;
        const y = cy + Math.sin(angle) * ringRadius;
        return (
          <circle
            key={i}
            ref={(el) => {
              dotsRef.current[i] = el;
            }}
            cx={x}
            cy={y}
            r={DOT_RING_BASE_RADIUS}
            fill={STATE_COLORS.idle}
            opacity={0.3}
          />
        );
      })}
    </svg>
  );
}
