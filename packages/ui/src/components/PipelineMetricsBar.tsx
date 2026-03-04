import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { PipelineTimings } from '@unctad-ai/voice-agent-core';
import {
  DEFAULT_SHOW_PIPELINE_METRICS,
  DEFAULT_PIPELINE_METRICS_AUTO_HIDE_MS,
} from '@unctad-ai/voice-agent-core';

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export default function PipelineMetricsBar({
  timings,
  show = DEFAULT_SHOW_PIPELINE_METRICS,
  autoHideMs = DEFAULT_PIPELINE_METRICS_AUTO_HIDE_MS,
}: {
  timings: PipelineTimings | null;
  show?: boolean;
  autoHideMs?: number;
}) {
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState<PipelineTimings | null>(null);

  // React-recommended pattern: adjust state during render based on prop change.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevTimings, setPrevTimings] = useState(timings);
  if (timings !== prevTimings) {
    setPrevTimings(timings);
    if (timings) {
      setDisplay(timings);
      setVisible(true);
    }
  }

  // Auto-hide timer: only the setTimeout callback calls setState (async, not synchronous)
  useEffect(() => {
    if (!visible || autoHideMs <= 0) return;
    const timer = setTimeout(() => setVisible(false), autoHideMs);
    return () => clearTimeout(timer);
  }, [visible, display, autoHideMs]);

  if (!display || !show) return null;

  const pills: { label: string; value: string }[] = [];

  pills.push({ label: display.pipeline, value: '' });

  if (display.sttMs != null) pills.push({ label: 'STT', value: fmt(display.sttMs) });
  if (display.llmTotalMs != null) pills.push({ label: 'LLM', value: fmt(display.llmTotalMs) });
  if (display.ttsFirstChunkMs != null && display.ttsTotalMs != null) {
    pills.push({
      label: 'TTS',
      value: `${fmt(display.ttsFirstChunkMs)} / ${fmt(display.ttsTotalMs)}`,
    });
  } else if (display.ttsMs != null) {
    pills.push({ label: 'TTS', value: fmt(display.ttsMs) });
  }
  pills.push({ label: 'Total', value: fmt(display.totalMs) });

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 28 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex items-center gap-2 overflow-hidden select-none"
          style={{
            height: 28,
            padding: '0 16px',
            fontSize: 11,
            fontFamily: 'DM Sans, sans-serif',
            fontVariantNumeric: 'tabular-nums',
            borderTop: '1px solid rgba(0,0,0,0.06)',
            background: 'rgba(0,0,0,0.03)',
          }}
        >
          {pills.map((p, i) =>
            i === 0 ? (
              <span
                key="type"
                style={{
                  color: 'rgba(0,0,0,0.35)',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  fontSize: 10,
                  letterSpacing: '0.04em',
                }}
              >
                {p.label}
              </span>
            ) : (
              <span key={p.label} className="inline-flex items-center gap-1">
                <span style={{ color: 'rgba(0,0,0,0.4)' }}>{p.label}</span>
                <span style={{ color: 'rgba(0,0,0,0.65)', fontWeight: 500 }}>{p.value}</span>
              </span>
            )
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
