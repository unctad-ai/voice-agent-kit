import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, X, Mic, ArrowUp, Keyboard, RotateCw, Settings, VolumeX } from 'lucide-react';
import {
  useVoiceAgent,
  voiceStateToOrbState,
  checkLLMHealth,
  useSiteConfig,
  RECOVERY_POLL_MS,
  PANEL_WIDTH,
  PANEL_COLLAPSED_HEIGHT,
  PANEL_EXPANDED_HEIGHT,
  PANEL_BORDER_RADIUS,
  PANEL_BOTTOM,
  PANEL_RIGHT,
  PANEL_Z_INDEX,
  SPRING_PANEL,
  SPRING_MICRO,
  SPRING_PANEL_EXIT,
  DEFAULT_FONT_FAMILY,
} from '@unctad-ai/voice-agent-core';
import type { OrbState, VoiceToolResult, VoiceState, VoiceMessage, PipelineTimings } from '@unctad-ai/voice-agent-core';
import { useVoiceSettings } from '../contexts/VoiceSettingsContext';
import AgentAvatar from './AgentAvatar';
import { injectAgentFabCSS } from './agentFabStyles';
import VoiceTranscript from './VoiceTranscript';
import VoiceToolCard from './VoiceToolCard';
import VoiceErrorBoundary from './VoiceErrorBoundary';
import VoiceErrorDisplay from './VoiceErrorDisplay';
import type { VoiceErrorType } from './VoiceErrorDisplay';
import PipelineMetricsBar from './PipelineMetricsBar';
const VoiceSettingsView = lazy(() => import('./VoiceSettingsView'));

// ---------------------------------------------------------------------------
// State labels for composer bar
// ---------------------------------------------------------------------------
const STATE_LABELS: Record<VoiceState, string> = {
  IDLE: 'Tap mic to speak',
  LISTENING: 'Listening...',
  USER_SPEAKING: 'Listening...',
  PROCESSING: 'Processing...',
  AI_SPEAKING: 'Speaking...',
};

// ---------------------------------------------------------------------------
// Aria-live announcements for screen readers
// ---------------------------------------------------------------------------
const ARIA_LIVE_LABELS: Record<OrbState, string> = {
  idle: '',
  listening: 'Listening for your question',
  processing: 'Processing your request',
  speaking: 'Playing response',
  error: 'An error occurred',
};

// ---------------------------------------------------------------------------
// Panel states
// ---------------------------------------------------------------------------
type PanelState = 'hidden' | 'collapsed' | 'expanded';

interface GlassCopilotPanelProps {
  isOpen: boolean;
  onOpen?: () => void;
  onClose: () => void;
  onStateChange?: (orbState: OrbState) => void;
  /** URL for the avatar portrait image */
  portraitSrc?: string;
}

// ---------------------------------------------------------------------------
// FAB — shown when panel is hidden
// ---------------------------------------------------------------------------
function CopilotFAB({ onClick, portraitSrc }: { onClick: () => void; portraitSrc?: string }) {
  const { colors } = useSiteConfig();
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      className="shadow-lg cursor-pointer"
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        borderRadius: '50%',
        width: 54,
        height: 54,
      }}
      aria-label="Open voice assistant"
      data-testid="voice-agent-fab"
    >
      <div className="agent-fab-border" style={{ width: 54, height: 54, '--agent-primary': colors.primary } as React.CSSProperties}>
        <div className="agent-fab-border-inner">
          {portraitSrc ? (
            <img
              src={portraitSrc}
              alt="Assistant"
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
              draggable={false}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#6b7280',
                color: 'white',
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              AI
            </div>
          )}
        </div>
      </div>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// Collapsed header bar
// ---------------------------------------------------------------------------
function CollapsedBar({
  orbState,
  getAmplitude,
  analyser: _analyser,
  voiceState,
  onExpand,
  onClose,
  onRetry,
  isRetrying = false,
  voiceError,
  micPaused = false,
  onMicToggle,
  ttsEnabled = true,
  copilotName,
  portraitSrc,
}: {
  orbState: OrbState;
  getAmplitude: () => number;
  analyser: AnalyserNode | null;
  voiceState: VoiceState;
  onExpand: () => void;
  onClose: () => void;
  onRetry?: () => void;
  isRetrying?: boolean;
  voiceError?: VoiceErrorType;
  micPaused?: boolean;
  onMicToggle?: () => void;
  ttsEnabled?: boolean;
  copilotName: string;
  portraitSrc?: string;
}) {
  const { colors } = useSiteConfig();
  const isOffline = voiceError === 'network_error';

  return (
    <div
      className="flex items-center gap-3 h-full cursor-pointer select-none"
      style={{ padding: '0 16px' }}
      role="button"
      tabIndex={0}
      data-testid="voice-agent-bar"
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onExpand();
        }
      }}
    >
      {/* Mini avatar */}
      <div
        className="relative shrink-0"
        style={{ width: 46, height: 46, opacity: isOffline ? 0.4 : 1 }}
      >
        <AgentAvatar state={orbState} getAmplitude={getAmplitude} size={46} portraitSrc={portraitSrc} />
        {!ttsEnabled && (
          <div
            className="absolute flex items-center justify-center"
            style={{
              bottom: -2,
              right: -2,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: 'rgba(0,0,0,0.65)',
              border: '1.5px solid rgba(255,255,255,0.8)',
            }}
          >
            <VolumeX style={{ width: 10, height: 10, color: '#fff' }} />
          </div>
        )}
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <p
          className="truncate"
          style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}
        >
          {copilotName}
        </p>
        <p
          className="truncate"
          style={{
            fontSize: '12px',
            fontWeight: 400,
            color: isOffline ? 'rgba(220, 38, 38, 0.7)' : 'rgba(0,0,0,0.42)',
            letterSpacing: '0.01em',
          }}
        >
          {isOffline ? (
            <span className="inline-flex items-center gap-1">
              Offline
              {onRetry && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry();
                  }}
                  className="inline-flex items-center justify-center rounded-full transition-colors cursor-pointer"
                  style={{
                    width: 18,
                    height: 18,
                    color: 'rgba(220, 38, 38, 0.5)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'rgba(220, 38, 38, 0.8)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'rgba(220, 38, 38, 0.5)';
                  }}
                  aria-label="Retry connection"
                >
                  <motion.span
                    animate={isRetrying ? { rotate: 360 } : { rotate: 0 }}
                    transition={
                      isRetrying
                        ? { duration: 0.8, repeat: Infinity, ease: 'linear' }
                        : { duration: 0.3 }
                    }
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <RotateCw style={{ width: 12, height: 12 }} />
                  </motion.span>
                </button>
              )}
            </span>
          ) : micPaused ? (
            'Paused'
          ) : (
            STATE_LABELS[voiceState]
          )}
        </p>
      </div>

      {/* Mic toggle button */}
      {!isOffline && onMicToggle && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMicToggle();
          }}
          className="shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer relative"
          style={{
            width: 44,
            height: 44,
            backgroundColor:
              voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING'
                ? colors.primary
                : 'rgba(0,0,0,0.06)',
            color:
              voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING'
                ? 'white'
                : 'rgba(0,0,0,0.45)',
          }}
          aria-label={
            voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING'
              ? 'Stop listening'
              : 'Start listening'
          }
        >
          {(voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING') && (
            <motion.span
              className="absolute inset-0 rounded-full"
              animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ backgroundColor: `${colors.primary}40` }}
            />
          )}
          <Mic style={{ width: 16, height: 16, position: 'relative', zIndex: 1 }} />
        </button>
      )}

      {/* Offline status dot */}
      {isOffline && (
        <span
          className="shrink-0 rounded-full"
          style={{
            width: 8,
            height: 8,
            backgroundColor: 'rgba(220, 38, 38, 0.5)',
          }}
        />
      )}

      {/* Close */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="shrink-0 rounded-full flex items-center justify-center transition-colors cursor-pointer"
        style={{
          width: 44,
          height: 44,
          color: 'rgba(0,0,0,0.4)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = 'rgba(0,0,0,0.7)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = 'rgba(0,0,0,0.4)';
        }}
        aria-label="Close voice assistant"
      >
        <X style={{ width: 18, height: 18 }} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer bar
// ---------------------------------------------------------------------------
function ComposerBar({
  voiceState,
  isListening,
  micPaused = false,
  onTextSubmit,
  onMicToggle,
  disabled = false,
}: {
  voiceState: VoiceState;
  isListening: boolean;
  micPaused?: boolean;
  onTextSubmit: (text: string) => void;
  onMicToggle: () => void;
  disabled?: boolean;
}) {
  const { colors } = useSiteConfig();
  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'text') {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [mode]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onTextSubmit(trimmed);
    setText('');
    setMode('voice');
  };

  const handleCancel = () => {
    setText('');
    setMode('voice');
    onMicToggle();
  };

  if (disabled) {
    return (
      <div
        className="flex items-center gap-3 shrink-0"
        style={{
          height: 56,
          padding: '10px 14px',
          borderTop: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        <div
          className="shrink-0 rounded-full flex items-center justify-center"
          style={{
            width: 36,
            height: 36,
            backgroundColor: 'rgba(0,0,0,0.04)',
            color: 'rgba(0,0,0,0.2)',
            opacity: 0.5,
          }}
        >
          <Mic style={{ width: 18, height: 18 }} />
        </div>
        <span
          className="italic"
          style={{ fontSize: '13px', color: 'rgba(0,0,0,0.3)' }}
        >
          Service unavailable
        </span>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 overflow-hidden"
      style={{
        height: 56,
        borderTop: '1px solid rgba(0,0,0,0.08)',
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {mode === 'voice' ? (
          <motion.div
            key="voice-mode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-3"
            style={{ height: 56, padding: '10px 14px' }}
          >
            <button
              onClick={onMicToggle}
              className="shrink-0 rounded-full flex items-center justify-center transition-all relative cursor-pointer"
              style={{
                width: 44,
                height: 44,
                backgroundColor: isListening ? colors.primary : 'rgba(0,0,0,0.06)',
                color: isListening ? 'white' : 'rgba(0,0,0,0.5)',
              }}
              aria-label={isListening ? 'Stop listening' : 'Start listening'}
              data-testid="voice-agent-mic"
            >
              {isListening && (
                <motion.span
                  className="absolute inset-0 rounded-full"
                  animate={{ scale: [1, 1.22, 1], opacity: [0.25, 0.08, 0.25] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ backgroundColor: `${colors.primary}33`, filter: 'blur(4px)' }}
                />
              )}
              <Mic style={{ width: 18, height: 18, position: 'relative', zIndex: 1 }} />
            </button>

            <div className="flex-1 min-w-0">
              <AnimatePresence mode="wait">
                <motion.p
                  key={micPaused ? 'paused' : voiceState}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="truncate"
                  style={{
                    fontSize: '14px',
                    fontWeight: 400,
                    color: micPaused
                      ? 'rgba(0,0,0,0.35)'
                      : voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING'
                        ? colors.primary
                        : 'rgba(0,0,0,0.45)',
                  }}
                >
                  {micPaused ? 'Paused' : STATE_LABELS[voiceState]}
                </motion.p>
              </AnimatePresence>
            </div>

            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                if (isListening) onMicToggle();
                setMode('text');
              }}
              className="shrink-0 rounded-full flex items-center justify-center cursor-pointer"
              style={{
                width: 44,
                height: 44,
                backgroundColor: 'rgba(0,0,0,0.05)',
                color: 'rgba(0,0,0,0.4)',
              }}
              aria-label="Type a message"
              data-testid="voice-agent-keyboard"
            >
              <Keyboard style={{ width: 18, height: 18 }} />
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="text-mode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2"
            style={{ height: 56, padding: '10px 14px' }}
          >
            <div
              className="flex-1 min-w-0 flex items-center"
              style={{
                height: 36,
                borderRadius: 18,
                padding: '0 14px',
                backgroundColor: 'rgba(0,0,0,0.03)',
                border: '1px solid rgba(0,0,0,0.08)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') handleCancel();
                }}
                onFocus={(e) => {
                  const pill = e.currentTarget.parentElement;
                  if (pill) {
                    pill.style.borderColor = `${colors.primary}4D`;
                    pill.style.boxShadow = `0 0 0 2px ${colors.primary}14`;
                  }
                }}
                onBlur={(e) => {
                  const pill = e.currentTarget.parentElement;
                  if (pill) {
                    pill.style.borderColor = 'rgba(0,0,0,0.08)';
                    pill.style.boxShadow = 'none';
                  }
                }}
                placeholder="Ask about services..."
                aria-label="Type your question"
                data-testid="voice-agent-input"
                className="w-full"
                style={{
                  fontSize: '14px',
                  color: '#1a1a1a',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  padding: 0,
                }}
              />
            </div>

            <AnimatePresence>
              {text.trim().length > 0 && (
                <motion.button
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={SPRING_MICRO}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleSubmit}
                  className="shrink-0 rounded-full flex items-center justify-center cursor-pointer"
                  style={{
                    width: 44,
                    height: 44,
                    backgroundColor: colors.primary,
                    color: 'white',
                  }}
                  aria-label="Send message"
                  data-testid="voice-agent-send"
                >
                  <ArrowUp style={{ width: 18, height: 18 }} />
                </motion.button>
              )}
            </AnimatePresence>

            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={handleCancel}
              className="shrink-0 rounded-full flex items-center justify-center cursor-pointer"
              style={{
                width: 44,
                height: 44,
                backgroundColor: 'rgba(0,0,0,0.05)',
                color: 'rgba(0,0,0,0.4)',
              }}
              aria-label="Back to voice mode"
              data-testid="voice-agent-voice-mode"
            >
              <Mic style={{ width: 18, height: 18 }} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded panel content
// ---------------------------------------------------------------------------
function ExpandedContent({
  orbState, getAmplitude, analyser, voiceState, messages, isTyping,
  toolResult, voiceError, dismissError, onCollapse, onClose, onTextSubmit,
  onMicToggle, micPaused = false, onToolDismiss, onInteraction, onRetry,
  isRetrying = false, lastTimings, showPipelineMetrics, pipelineMetricsAutoHideMs,
  showSettings, onSettingsToggle, ttsEnabled = true, copilotName, portraitSrc,
}: {
  orbState: OrbState; getAmplitude: () => number; analyser: AnalyserNode | null;
  voiceState: VoiceState; messages: VoiceMessage[]; isTyping: boolean;
  toolResult: VoiceToolResult | null; voiceError: VoiceErrorType; dismissError: () => void;
  onCollapse: () => void; onClose: () => void; onTextSubmit: (text: string) => void;
  onMicToggle: () => void; micPaused?: boolean; onToolDismiss: () => void;
  onInteraction: () => void; onRetry?: () => void; isRetrying?: boolean;
  lastTimings?: PipelineTimings | null; showPipelineMetrics?: boolean;
  pipelineMetricsAutoHideMs?: number; showSettings: boolean; onSettingsToggle: () => void;
  ttsEnabled?: boolean; copilotName: string; portraitSrc?: string;
}) {
  const { colors } = useSiteConfig();
  const isListening = voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING';
  const isOffline = voiceError === 'network_error';

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      onClick={onInteraction}
      onKeyDown={onInteraction}
    >
      {/* Header (64px) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1], delay: 0.12 }}
        className="flex items-center gap-3 shrink-0"
        style={{ height: 64, padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}
      >
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1, opacity: isOffline ? 0.35 : 1 }}
          transition={{ ...SPRING_MICRO, delay: 0.14 }}
          className="relative shrink-0"
          style={{ width: 46, height: 46, filter: isOffline ? 'grayscale(0.8)' : 'none' }}
        >
          <AgentAvatar state={orbState} getAmplitude={getAmplitude} size={46} showRing portraitSrc={portraitSrc} />
          {!ttsEnabled && (
            <div
              className="absolute flex items-center justify-center"
              style={{
                bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9,
                backgroundColor: 'rgba(0,0,0,0.65)', border: '1.5px solid rgba(255,255,255,0.8)',
              }}
            >
              <VolumeX style={{ width: 10, height: 10, color: '#fff' }} />
            </div>
          )}
        </motion.div>

        <div className="flex-1 min-w-0">
          <p className="truncate" style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{copilotName}</p>
          <p className="truncate" data-testid="voice-agent-status" style={{ fontSize: '12px', fontWeight: 400, color: isOffline ? 'rgba(220,38,38,0.7)' : 'rgba(0,0,0,0.42)', letterSpacing: '0.01em' }}>
            {isOffline ? (
              <span className="inline-flex items-center gap-1">
                Offline
                {onRetry && (
                  <button onClick={(e) => { e.stopPropagation(); onRetry(); }} className="inline-flex items-center justify-center rounded-full transition-colors cursor-pointer" style={{ width: 18, height: 18, color: 'rgba(220,38,38,0.5)' }} aria-label="Retry connection">
                    <motion.span animate={isRetrying ? { rotate: 360 } : { rotate: 0 }} transition={isRetrying ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <RotateCw style={{ width: 12, height: 12 }} />
                    </motion.span>
                  </button>
                )}
              </span>
            ) : micPaused ? 'Paused' : STATE_LABELS[voiceState]}
          </p>
        </div>

        <button
          onClick={onSettingsToggle}
          className="shrink-0 rounded-full transition-colors cursor-pointer"
          style={{
            color: showSettings ? colors.primary : 'rgba(0,0,0,0.4)',
            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: showSettings ? `${colors.primary}14` : 'rgba(0,0,0,0.05)',
          }}
          aria-label={showSettings ? 'Close settings' : 'Open settings'}
          data-testid="voice-agent-settings"
        >
          <Settings style={{ width: 16, height: 16 }} />
        </button>
        <button onClick={onCollapse} className="shrink-0 rounded-full transition-colors cursor-pointer" style={{ color: 'rgba(0,0,0,0.4)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)' }} aria-label="Minimize panel" data-testid="voice-agent-minimize">
          <ChevronDown style={{ width: 16, height: 16 }} />
        </button>
        <button onClick={onClose} className="shrink-0 rounded-full transition-colors cursor-pointer" style={{ color: 'rgba(0,0,0,0.4)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.05)' }} aria-label="Close voice assistant" data-testid="voice-agent-close">
          <X style={{ width: 16, height: 16 }} />
        </button>
      </motion.div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div data-testid="voice-agent-transcript"><VoiceTranscript messages={messages} isTyping={isTyping} variant="panel" voiceError={voiceError} /></div>
        <div className="shrink-0">
          <PipelineMetricsBar timings={lastTimings ?? null} show={showPipelineMetrics} autoHideMs={pipelineMetricsAutoHideMs} />
          {isOffline && onRetry && (
            <div style={{ padding: '0 16px 8px', display: 'flex', justifyContent: 'center' }}>
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={onRetry} disabled={isRetrying} className="inline-flex items-center gap-2 rounded-full cursor-pointer transition-colors" style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 500, color: isRetrying ? 'rgba(0,0,0,0.35)' : 'rgba(220,38,38,0.8)', backgroundColor: isRetrying ? 'rgba(0,0,0,0.04)' : 'rgba(220,38,38,0.08)', border: '1px solid', borderColor: isRetrying ? 'rgba(0,0,0,0.06)' : 'rgba(220,38,38,0.15)' }} aria-label="Retry connection">
                <motion.span animate={isRetrying ? { rotate: 360 } : { rotate: 0 }} transition={isRetrying ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RotateCw style={{ width: 14, height: 14 }} />
                </motion.span>
                {isRetrying ? 'Checking...' : 'Retry connection'}
              </motion.button>
            </div>
          )}
          {voiceError !== 'network_error' && (
            <div style={{ padding: '0 16px 8px' }}><VoiceErrorDisplay error={voiceError} onDismiss={dismissError} /></div>
          )}
          <div style={{ padding: '0 16px 8px' }}><VoiceToolCard result={toolResult} onDismiss={onToolDismiss} variant="capsule" /></div>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_MICRO, delay: 0.2 }} className="shrink-0">
        <ComposerBar voiceState={voiceState} isListening={isListening} micPaused={micPaused} onTextSubmit={onTextSubmit} onMicToggle={onMicToggle} disabled={voiceError === 'network_error'} />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static panel shell
// ---------------------------------------------------------------------------
function StaticPanelShell({
  panelState, onCollapse, onExpand, onClose, onRetry, copilotName, portraitSrc,
}: {
  panelState: PanelState; onCollapse: () => void; onExpand: () => void; onClose: () => void;
  onRetry?: () => Promise<boolean>; copilotName: string; portraitSrc?: string;
}) {
  const noopAmplitude = useCallback(() => 0, []);
  const [isRetrying, setIsRetrying] = useState(false);
  const handleRetry = useCallback(() => { if (isRetrying || !onRetry) return; setIsRetrying(true); onRetry().finally(() => setIsRetrying(false)); }, [onRetry, isRetrying]);

  if (panelState === 'collapsed') {
    return <CollapsedBar orbState="idle" getAmplitude={noopAmplitude} analyser={null} voiceState="IDLE" onExpand={onExpand} onClose={onClose} onRetry={handleRetry} isRetrying={isRetrying} voiceError="network_error" copilotName={copilotName} portraitSrc={portraitSrc} />;
  }
  return <ExpandedContent orbState="idle" getAmplitude={noopAmplitude} analyser={null} voiceState="IDLE" messages={[]} isTyping={false} toolResult={null} voiceError="network_error" dismissError={() => {}} onCollapse={onCollapse} onClose={onClose} onTextSubmit={() => {}} onMicToggle={() => {}} onToolDismiss={() => {}} onInteraction={() => {}} onRetry={handleRetry} isRetrying={isRetrying} showSettings={false} onSettingsToggle={() => {}} copilotName={copilotName} portraitSrc={portraitSrc} />;
}

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------
class WiredPanelErrorBoundary extends Component<
  { children: ReactNode; panelState: PanelState; onCollapse: () => void; onExpand: () => void; onClose: () => void; copilotName: string; portraitSrc?: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { console.warn('[GlassCopilotPanel] Voice agent unavailable:', error.message); }
  handleRetry = (): Promise<boolean> => {
    return checkLLMHealth().then(({ available }) => {
      if (available) this.setState({ hasError: false });
      return available;
    });
  };
  render() {
    if (this.state.hasError) {
      return <StaticPanelShell panelState={this.props.panelState} onCollapse={this.props.onCollapse} onExpand={this.props.onExpand} onClose={this.props.onClose} onRetry={this.handleRetry} copilotName={this.props.copilotName} portraitSrc={this.props.portraitSrc} />;
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Wired panel
// ---------------------------------------------------------------------------
function WiredPanel({
  panelState, onCollapse, onExpand, onClose, onStateChange, portraitSrc,
}: {
  panelState: PanelState; onCollapse: () => void; onExpand: () => void; onClose: () => void;
  onStateChange?: (orbState: OrbState) => void; portraitSrc?: string;
}) {
  const config = useSiteConfig();
  return (
    <WiredPanelErrorBoundary panelState={panelState} onCollapse={onCollapse} onExpand={onExpand} onClose={onClose} copilotName={config.copilotName} portraitSrc={portraitSrc}>
      <WiredPanelInner panelState={panelState} onCollapse={onCollapse} onExpand={onExpand} onClose={onClose} onStateChange={onStateChange} portraitSrc={portraitSrc} />
    </WiredPanelErrorBoundary>
  );
}

function WiredPanelInner({
  panelState, onCollapse, onExpand, onClose, onStateChange, portraitSrc,
}: {
  panelState: PanelState; onCollapse: () => void; onExpand: () => void; onClose: () => void;
  onStateChange?: (orbState: OrbState) => void; portraitSrc?: string;
}) {
  const config = useSiteConfig();
  const resolvedPortrait = portraitSrc ?? config.avatarUrl;
  const { settings: voiceSettings, volumeRef, speedRef } = useVoiceSettings();
  const { state, start, stop, messages, isLLMLoading, getAmplitude, analyser, sendTextMessage, voiceError, dismissError, sessionEnded, lastTimings, applyVolume, settings } = useVoiceAgent({ settings: voiceSettings, volumeRef, speedRef });

  useEffect(() => { if (sessionEnded) onClose(); }, [sessionEnded, onClose]);

  const [toolResult, setToolResult] = useState<VoiceToolResult | null>(null);
  const orbState = voiceStateToOrbState(state);
  const [backendDown, setBackendDown] = useState(false);
  const autoStartedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const runHealthCheck = useCallback(() => {
    checkLLMHealth().then(({ available }) => {
      if (cancelledRef.current) return;
      setBackendDown(!available);
      if (available) {
        dismissError();
        if (!autoStartedRef.current && settings.autoListen) { autoStartedRef.current = true; startRef.current(); }
      } else {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(runHealthCheck, RECOVERY_POLL_MS);
      }
    });
  }, [dismissError, settings.autoListen]);

  useEffect(() => { cancelledRef.current = false; runHealthCheck(); return () => { cancelledRef.current = true; if (pollTimerRef.current) clearTimeout(pollTimerRef.current); }; }, [runHealthCheck]);

  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; });
  useEffect(() => { onStateChangeRef.current?.(orbState); }, [orbState]);

  const startRef = useRef(start);
  const stopRef = useRef(stop);
  useEffect(() => { startRef.current = start; }, [start]);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useEffect(() => { return () => { stopRef.current(true); }; }, []);

  const [micPaused, setMicPaused] = useState(false);
  const [activity, setActivity] = useState(0);
  const hasConversationRef = useRef(false);
  hasConversationRef.current = messages.length > 0;
  const onCollapseRef = useRef(onCollapse);
  useEffect(() => { onCollapseRef.current = onCollapse; });

  const bumpActivity = useCallback(() => { setActivity((c) => c + 1); }, []);

  const handleMicToggle = useCallback(() => {
    setMicPaused(false); bumpActivity();
    if (state === 'LISTENING' || state === 'USER_SPEAKING') { stop(); }
    else if (state === 'IDLE') { start(); }
  }, [state, start, stop, bumpActivity]);

  useEffect(() => { if (panelState === 'hidden') stopRef.current(true); }, [panelState]);

  useEffect(() => {
    if (panelState === 'hidden' || micPaused) return;
    if (state === 'PROCESSING' || state === 'AI_SPEAKING') return;
    const timer = setTimeout(() => { stopRef.current(); if (hasConversationRef.current) { setMicPaused(true); } else { onCollapseRef.current(); } }, settings.idleTimeoutMs);
    return () => clearTimeout(timer);
  }, [state, panelState, micPaused, activity, settings.idleTimeoutMs]);

  useEffect(() => {
    if (!micPaused || panelState !== 'expanded') return;
    if (settings.panelCollapseTimeoutMs === 0) return;
    const timer = setTimeout(() => { onCollapseRef.current(); }, settings.panelCollapseTimeoutMs);
    return () => clearTimeout(timer);
  }, [micPaused, panelState, activity, settings.panelCollapseTimeoutMs]);

  const handleTextSubmit = useCallback((text: string) => { setMicPaused(false); bumpActivity(); sendTextMessage(text); }, [sendTextMessage, bumpActivity]);

  const isTyping = state === 'AI_SPEAKING' || isLLMLoading;
  const effectiveError = backendDown ? ('network_error' as const) : voiceError;

  const [isRetrying, setIsRetrying] = useState(false);
  const handleRetryClick = useCallback(() => {
    if (isRetrying) return; setIsRetrying(true);
    checkLLMHealth().then(({ available }) => {
      if (cancelledRef.current) return; setIsRetrying(false); setBackendDown(!available);
      if (available) { dismissError(); if (!autoStartedRef.current && settings.autoListen) { autoStartedRef.current = true; startRef.current(); } }
      if (!available) { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); pollTimerRef.current = setTimeout(runHealthCheck, RECOVERY_POLL_MS); }
    }).catch(() => setIsRetrying(false));
  }, [isRetrying, runHealthCheck, dismissError, settings.autoListen]);

  const [showSettings, setShowSettings] = useState(false);
  const toggleSettings = useCallback(() => setShowSettings((p) => !p), []);

  if (panelState === 'collapsed') {
    return <CollapsedBar orbState={orbState} getAmplitude={getAmplitude} analyser={analyser} voiceState={state} onExpand={onExpand} onClose={onClose} onRetry={handleRetryClick} isRetrying={isRetrying} voiceError={effectiveError} micPaused={micPaused} onMicToggle={handleMicToggle} ttsEnabled={settings.ttsEnabled} copilotName={config.copilotName} portraitSrc={resolvedPortrait} />;
  }

  return (
    <div className="relative h-full">
      <ExpandedContent orbState={orbState} getAmplitude={getAmplitude} analyser={analyser} voiceState={state} messages={messages} isTyping={isTyping} toolResult={toolResult} voiceError={effectiveError} dismissError={dismissError} onCollapse={onCollapse} onClose={onClose} onTextSubmit={handleTextSubmit} onMicToggle={handleMicToggle} micPaused={micPaused} onToolDismiss={() => setToolResult(null)} onInteraction={bumpActivity} onRetry={handleRetryClick} isRetrying={isRetrying} lastTimings={lastTimings} showPipelineMetrics={settings.showPipelineMetrics} pipelineMetricsAutoHideMs={settings.pipelineMetricsAutoHideMs} showSettings={showSettings} onSettingsToggle={toggleSettings} ttsEnabled={settings.ttsEnabled} copilotName={config.copilotName} portraitSrc={resolvedPortrait} />
      <AnimatePresence>
        {showSettings && (<Suspense fallback={null}><VoiceSettingsView onBack={toggleSettings} onVolumeChange={applyVolume} /></Suspense>)}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------
export default function GlassCopilotPanel({ isOpen, onOpen, onClose, onStateChange, portraitSrc }: GlassCopilotPanelProps) {
  injectAgentFabCSS();
  const config = useSiteConfig();
  const resolvedPortrait = portraitSrc ?? config.avatarUrl;
  const [internalState, setInternalState] = useState<'collapsed' | 'expanded'>('collapsed');
  const panelState: PanelState = isOpen ? internalState : 'hidden';
  const handleClose = useCallback(() => { onClose(); }, [onClose]);
  const handleCollapse = useCallback(() => { setInternalState('collapsed'); }, []);
  const handleExpand = useCallback(() => { setInternalState('expanded'); }, []);

  const isVisible = panelState !== 'hidden';
  const isExpanded = panelState === 'expanded';
  const targetHeight = isExpanded ? PANEL_EXPANDED_HEIGHT : PANEL_COLLAPSED_HEIGHT;

  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLDivElement>(null);
  const prevVisibleRef = useRef(isVisible);

  useEffect(() => {
    if (isVisible && !prevVisibleRef.current) { requestAnimationFrame(() => panelRef.current?.focus()); }
    else if (!isVisible && prevVisibleRef.current) { requestAnimationFrame(() => { const fabButton = fabRef.current?.querySelector('button'); fabButton?.focus(); }); }
    prevVisibleRef.current = isVisible;
  }, [isVisible]);

  const [ariaAnnouncement, setAriaAnnouncement] = useState('');
  const handleStateChange = useCallback((orbState: OrbState) => { setAriaAnnouncement(ARIA_LIVE_LABELS[orbState]); onStateChange?.(orbState); }, [onStateChange]);

  return createPortal(
    <VoiceErrorBoundary onReset={handleClose}>
      <svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }} aria-hidden="true">
        <defs>
          <filter id="liquid-glass-panel" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="42" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="2" result="blurred_noise" />
            <feDisplacementMap in="SourceGraphic" in2="blurred_noise" scale="50" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <span aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', borderWidth: 0 }}>
        {ariaAnnouncement}
      </span>

      <AnimatePresence>
        {!isVisible && (
          <motion.div ref={fabRef} key="copilot-fab" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} className="fixed" style={{ bottom: PANEL_BOTTOM, right: PANEL_RIGHT, zIndex: PANEL_Z_INDEX }}>
            <CopilotFAB onClick={() => onOpen?.()} portraitSrc={resolvedPortrait} />
          </motion.div>
        )}

        {isVisible && (
          <motion.div ref={panelRef} tabIndex={-1} key="copilot-panel" role="dialog" aria-label="Voice Assistant" aria-modal="false" data-testid="voice-agent-panel"
            initial={{ width: 48, height: 48, borderRadius: 24, opacity: 0, scale: 0.9 }}
            animate={{ width: PANEL_WIDTH, height: Math.min(targetHeight, window.innerHeight - 48), borderRadius: PANEL_BORDER_RADIUS, opacity: 1, scale: 1, transition: SPRING_PANEL }}
            exit={{ width: 48, height: 48, borderRadius: 24, opacity: 0, scale: 0.95, transition: SPRING_PANEL_EXIT }}
            className="fixed"
            style={{ bottom: PANEL_BOTTOM, right: PANEL_RIGHT, zIndex: PANEL_Z_INDEX, transformOrigin: 'bottom right', maxWidth: 'calc(100vw - 32px)', outline: 'none', fontFamily: config.fontFamily ?? DEFAULT_FONT_FAMILY }}
          >
            <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: PANEL_BORDER_RADIUS, overflow: 'hidden', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', filter: 'url(#liquid-glass-panel)', isolation: 'isolate' }} />
            <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: PANEL_BORDER_RADIUS, overflow: 'hidden', backdropFilter: 'blur(14px) saturate(1.4)', WebkitBackdropFilter: 'blur(14px) saturate(1.4)', backgroundColor: 'rgba(230,232,245,0.32)', border: '1px solid rgba(255,255,255,0.4)', boxShadow: 'inset 0 0 20px -5px rgba(255,255,255,0.3), inset 0 1px 0 0 rgba(255,255,255,0.8), 0 0 0 1px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.14), 0 24px 48px rgba(0,0,0,0.10)' }} />
            <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: PANEL_BORDER_RADIUS, background: 'linear-gradient(to bottom, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 20%)' }} />
            <div style={{ position: 'relative', zIndex: 1, height: '100%', overflow: 'hidden', borderRadius: PANEL_BORDER_RADIUS }}>
              <WiredPanel panelState={panelState} onCollapse={handleCollapse} onExpand={handleExpand} onClose={handleClose} onStateChange={handleStateChange} portraitSrc={resolvedPortrait} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </VoiceErrorBoundary>,
    document.body
  );
}
