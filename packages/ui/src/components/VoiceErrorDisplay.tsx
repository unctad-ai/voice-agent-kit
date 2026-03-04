import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Hourglass, Mic, MicOff, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { cn } from '../utils';

export type VoiceErrorType =
  | 'mic_denied'
  | 'mic_unavailable'
  | 'vad_load_failed'
  | 'stt_failed'
  | 'tts_failed'
  | 'network_error'
  | 'llm_failed'
  | 'speech_too_short'
  | 'not_addressed'
  | 'processing'
  | null;

interface VoiceErrorDisplayProps {
  error: VoiceErrorType;
  onDismiss: () => void;
}

type Severity = 'error' | 'warning' | 'info';

const SEVERITY_STYLES: Record<
  Severity,
  { bg: string; border: string; icon: string; text: string; dismiss: string }
> = {
  error: {
    bg: 'rgba(220, 38, 38, 0.08)',
    border: 'rgba(220, 38, 38, 0.15)',
    icon: 'text-red-500',
    text: 'text-red-700',
    dismiss: 'text-red-400 hover:text-red-600',
  },
  warning: {
    bg: 'rgba(217, 119, 6, 0.08)',
    border: 'rgba(217, 119, 6, 0.15)',
    icon: 'text-amber-500',
    text: 'text-amber-700',
    dismiss: 'text-amber-400 hover:text-amber-600',
  },
  info: {
    bg: 'rgba(0, 0, 0, 0.04)',
    border: 'rgba(0, 0, 0, 0.08)',
    icon: 'text-neutral-500',
    text: 'text-neutral-600',
    dismiss: 'text-neutral-400 hover:text-neutral-600',
  },
};

const ERROR_CONFIG: Record<
  NonNullable<VoiceErrorType>,
  { icon: typeof AlertTriangle; title: string; severity: Severity }
> = {
  mic_denied: {
    icon: MicOff,
    title: 'Microphone access denied',
    severity: 'error',
  },
  mic_unavailable: {
    icon: MicOff,
    title: 'No microphone found',
    severity: 'error',
  },
  vad_load_failed: {
    icon: AlertTriangle,
    title: 'Voice detection unavailable',
    severity: 'warning',
  },
  stt_failed: {
    icon: Mic,
    title: "Didn't catch that",
    severity: 'info',
  },
  tts_failed: {
    icon: AlertTriangle,
    title: 'Voice response unavailable',
    severity: 'warning',
  },
  network_error: {
    icon: WifiOff,
    title: 'Connection lost',
    severity: 'error',
  },
  llm_failed: {
    icon: Wifi,
    title: 'AI service unavailable',
    severity: 'error',
  },
  speech_too_short: {
    icon: Mic,
    title: "Didn't catch that",
    severity: 'info',
  },
  not_addressed: {
    icon: VolumeX,
    title: 'Not addressed to me',
    severity: 'info',
  },
  processing: {
    icon: Hourglass,
    title: 'Still processing...',
    severity: 'info',
  },
};

export default function VoiceErrorDisplay({ error, onDismiss }: VoiceErrorDisplayProps) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className={cn('max-w-xs mx-auto', 'rounded-xl', 'px-4 py-2')}
          style={{
            backgroundColor: SEVERITY_STYLES[ERROR_CONFIG[error].severity].bg,
            border: `1px solid ${SEVERITY_STYLES[ERROR_CONFIG[error].severity].border}`,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            pointerEvents: 'auto',
          }}
        >
          {(() => {
            const config = ERROR_CONFIG[error];
            const styles = SEVERITY_STYLES[config.severity];
            const Icon = config.icon;
            return (
              <div className="flex items-center gap-2">
                <Icon className={cn('h-4 w-4 shrink-0', styles.icon)} />
                <span className={cn('text-xs flex-1', styles.text)}>{config.title}</span>
                <button
                  onClick={onDismiss}
                  className={cn('text-xs transition-colors cursor-pointer', styles.dismiss)}
                >
                  &times;
                </button>
              </div>
            );
          })()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
