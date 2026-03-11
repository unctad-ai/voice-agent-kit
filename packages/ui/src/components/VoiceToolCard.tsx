import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '../utils';
import type { VoiceToolResult } from '@unctad-ai/voice-agent-core';

interface VoiceToolCardProps {
  result: VoiceToolResult | null;
  onAction?: (result: VoiceToolResult) => void;
  onDismiss?: () => void;
  /** When 'capsule', uses inline panel capsule style */
  variant?: 'overlay' | 'capsule';
}

const AUTO_DISMISS_MS = 8000;

export default function VoiceToolCard({
  result,
  onAction,
  onDismiss,
  variant = 'overlay',
}: VoiceToolCardProps) {
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  const isCapsule = variant === 'capsule';

  return (
    <AnimatePresence>
      {result && (
        <motion.div
          initial={{ opacity: 0, y: isCapsule ? 8 : 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: isCapsule ? 4 : 10 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={cn(
            'cursor-pointer transition-colors duration-200',
            isCapsule
              ? 'w-full rounded-xl px-4 py-2.5 flex items-center gap-3'
              : 'bg-white/10 backdrop-blur-md rounded-xl border border-white/20 px-5 py-4 max-w-sm w-full hover:bg-white/15'
          )}
          style={
            isCapsule
              ? {
                  backgroundColor: 'rgba(0,0,0,0.04)',
                  border: '1px solid rgba(0,0,0,0.08)',
                }
              : undefined
          }
          onClick={() => onAction?.(result)}
          onMouseEnter={
            isCapsule
              ? (e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,0,0,0.06)';
                }
              : undefined
          }
          onMouseLeave={
            isCapsule
              ? (e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,0,0,0.04)';
                }
              : undefined
          }
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onAction?.(result);
            }
          }}
        >
          {isCapsule ? (
            <>
              <ArrowUpRight
                className="shrink-0"
                style={{ width: 14, height: 14, color: 'rgba(0,0,0,0.5)' }}
              />
              <span
                className="truncate"
                style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(0,0,0,0.7)' }}
              >
                {result.displayText}
              </span>
            </>
          ) : (
            <>
              <p className="text-white/50 text-xs uppercase tracking-wider mb-1">{result.name}</p>
              <p className="text-white text-sm leading-relaxed">{result.displayText}</p>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
