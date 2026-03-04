import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { useVoiceAgent, voiceStateToOrbState } from '@voice-agent/core';
import { IDLE_TIMEOUT_MS, WIND_DOWN_MS, EXIT_ANIMATION_MS } from '@voice-agent/core';
import type { OrbState, VoiceToolResult } from '@voice-agent/core';
import { useVoiceSettings } from '../contexts/VoiceSettingsContext';
import VoiceOrb from './VoiceOrb';
import VoiceWaveformCanvas from './VoiceWaveformCanvas';
import VoiceTranscript from './VoiceTranscript';
import VoiceToolCard from './VoiceToolCard';
import VoiceControls from './VoiceControls';
import VoiceErrorBoundary from './VoiceErrorBoundary';
import VoiceErrorDisplay from './VoiceErrorDisplay';

/** Inline z-index guarantees stacking above all page elements */
const OVERLAY_Z = 2147483647;

/** Liquid spring configs for entrance choreography */
const SPRING_BOUNCY = { type: 'spring' as const, damping: 20, stiffness: 180 };
const SPRING_SMOOTH = { type: 'spring' as const, damping: 28, stiffness: 160 };

/** Exit easing — smooth start, accelerating pull */
const EXIT_EASE: [number, number, number, number] = [0.4, 0, 0.7, 0.2];

interface VoiceOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onStateChange?: (orbState: OrbState) => void;
}

function WiredOverlayContent({
  isMobile,
  onClose,
  onStateChange,
  isClosing,
}: {
  isMobile: boolean;
  onClose: () => void;
  onStateChange?: (orbState: OrbState) => void;
  isClosing: boolean;
}) {
  const orbSize = isMobile ? 120 : 200;
  const { settings, volumeRef, speedRef } = useVoiceSettings();

  const {
    state,
    start,
    stop,
    messages,
    isLLMLoading,
    getAmplitude,
    analyser,
    sendTextMessage,
    voiceError,
    dismissError,
  } = useVoiceAgent({ settings, volumeRef, speedRef });

  const [toolResult, setToolResult] = useState<VoiceToolResult | null>(null);

  const orbState = voiceStateToOrbState(state);

  // Notify parent of state changes for a11y announcer
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  useEffect(() => {
    onStateChangeRef.current?.(orbState);
  }, [orbState]);

  // Start VAD when overlay mounts, force-stop on unmount (bypass debounce)
  const startRef = useRef(start);
  const stopRef = useRef(stop);
  useEffect(() => {
    startRef.current = start;
  }, [start]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);
  useEffect(() => {
    startRef.current();
    return () => stopRef.current(true);
  }, []);

  // Stop VAD immediately when exit starts
  useEffect(() => {
    if (isClosing) stop();
  }, [isClosing, stop]);

  // --- Idle timeout: auto-close after 30s of no user activity ---
  const [isWindingDown, setIsWindingDown] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windDownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const clear = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (windDownTimerRef.current) clearTimeout(windDownTimerRef.current);
      idleTimerRef.current = null;
      windDownTimerRef.current = null;
    };

    if (isClosing || state === 'PROCESSING' || state === 'AI_SPEAKING') {
      clear();
      setIsWindingDown(false);
      return;
    }
    clear();
    setIsWindingDown(false);
    windDownTimerRef.current = setTimeout(() => {
      setIsWindingDown(true);
    }, IDLE_TIMEOUT_MS - WIND_DOWN_MS);
    idleTimerRef.current = setTimeout(() => {
      onCloseRef.current();
    }, IDLE_TIMEOUT_MS);
    return clear;
  }, [state, isClosing]);

  const handleTextSubmit = useCallback(
    (text: string) => {
      sendTextMessage(text);
    },
    [sendTextMessage]
  );

  const isListening = state === 'LISTENING' || state === 'USER_SPEAKING';

  return (
    <div
      className="flex flex-col items-center justify-center gap-6 h-full px-6"
      style={{ pointerEvents: 'none' }}
    >
      {/* Orb + Waveform */}
      <motion.div
        initial={{ opacity: 0, scale: 0.15 }}
        animate={
          isClosing
            ? { opacity: 0, scale: 0 }
            : { opacity: isWindingDown ? 0.3 : 1, scale: isWindingDown ? 0.92 : 1 }
        }
        transition={
          isClosing
            ? { duration: 0.3, ease: EXIT_EASE, delay: 0.15 }
            : isWindingDown
              ? { duration: WIND_DOWN_MS / 1000, ease: 'easeOut' }
              : { ...SPRING_BOUNCY, delay: 0.1 }
        }
        className="relative flex items-center justify-center"
        style={{ width: orbSize + 100, height: orbSize + 100, pointerEvents: 'auto' }}
      >
        <div
          className="absolute rounded-full"
          style={{
            width: orbSize + 100,
            height: orbSize + 100,
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            filter: 'url(#liquid-glass-orb)',
            isolation: 'isolate',
          }}
        />
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: orbSize + 100,
            height: orbSize + 100,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow:
              '0 6px 24px rgba(0, 0, 0, 0.08), inset 0 0 20px -5px rgba(255, 255, 255, 0.3)',
          }}
        />
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: orbSize + 100,
            height: orbSize + 100,
            background:
              'radial-gradient(ellipse 70% 40% at 50% 12%, rgba(255,255,255,0.2) 0%, transparent 55%)',
          }}
        />
        <VoiceWaveformCanvas analyserNode={analyser} state={orbState} size={orbSize + 100} />
        <div className="absolute rounded-full" style={{ width: orbSize, height: orbSize }}>
          <VoiceOrb state={orbState} getAmplitude={getAmplitude} size={orbSize} />
        </div>
      </motion.div>

      {/* Transcript */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={isClosing ? { opacity: 0, y: 16 } : { opacity: 1, y: 0 }}
        transition={
          isClosing
            ? { duration: 0.25, ease: EXIT_EASE, delay: 0.08 }
            : { ...SPRING_SMOOTH, delay: 0.3 }
        }
      >
        <VoiceTranscript messages={messages} isTyping={state === 'AI_SPEAKING' || isLLMLoading} />
      </motion.div>

      {/* Error display */}
      <div style={{ pointerEvents: 'auto' }}>
        <VoiceErrorDisplay error={voiceError} onDismiss={dismissError} />
      </div>

      {/* Tool result card */}
      <div style={{ pointerEvents: 'auto' }}>
        <VoiceToolCard result={toolResult} onDismiss={() => setToolResult(null)} />
      </div>

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 48 }}
        animate={isClosing ? { opacity: 0, y: 30 } : { opacity: 1, y: 0 }}
        transition={
          isClosing
            ? { duration: 0.25, ease: EXIT_EASE, delay: 0 }
            : { ...SPRING_SMOOTH, delay: 0.4 }
        }
        className="w-full"
        style={{ pointerEvents: 'auto' }}
      >
        <VoiceControls state={state} onTextSubmit={handleTextSubmit} isListening={isListening} />
      </motion.div>
    </div>
  );
}

function OverlayPortal({
  isOpen,
  isClosing,
  onClose,
  onStateChange,
  isMobile,
}: VoiceOverlayProps & { isMobile: boolean; isClosing: boolean }) {
  if (!isOpen) return null;

  return createPortal(
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="0"
        height="0"
        style={{ position: 'absolute', overflow: 'hidden' }}
        aria-hidden="true"
      >
        <defs>
          <filter id="liquid-glass-orb" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.008 0.008"
              numOctaves="2"
              seed="92"
              result="noise"
            />
            <feGaussianBlur in="noise" stdDeviation="2" result="blurred_noise" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="blurred_noise"
              scale="50"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <motion.div
        key="voice-overlay-bg"
        initial={{ opacity: 0 }}
        animate={isClosing ? { opacity: 0 } : { opacity: 1 }}
        transition={{
          duration: isClosing ? 0.35 : 0.4,
          ease: 'easeOut',
          delay: isClosing ? 0.2 : 0,
        }}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: OVERLAY_Z,
          pointerEvents: 'none',
          backgroundColor: 'rgba(0, 0, 0, 0.15)',
        }}
      />

      <motion.div
        key="voice-overlay-gradient"
        initial={{ opacity: 0, y: 80 }}
        animate={isClosing ? { opacity: 0, y: 60 } : { opacity: 1, y: 0 }}
        transition={
          isClosing
            ? { duration: 0.3, ease: EXIT_EASE, delay: 0.2 }
            : { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.05 }
        }
        aria-hidden="true"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '28rem',
          zIndex: OVERLAY_Z,
          pointerEvents: 'none',
          background:
            'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 40%, transparent 100%)',
        }}
      />

      <div
        role="dialog"
        aria-label="Voice Assistant"
        aria-modal="false"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: OVERLAY_Z,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <motion.button
          initial={{ opacity: 0, scale: 0.7 }}
          animate={isClosing ? { opacity: 0, scale: 0.7 } : { opacity: 1, scale: 1 }}
          transition={
            isClosing
              ? { duration: 0.2, ease: EXIT_EASE, delay: 0.06 }
              : { ...SPRING_SMOOTH, delay: 0.35 }
          }
          onClick={onClose}
          className="absolute top-6 right-6 flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer hover:scale-110"
          style={{
            pointerEvents: 'auto',
            zIndex: OVERLAY_Z,
            width: 44,
            height: 44,
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            color: 'rgba(255, 255, 255, 0.85)',
          }}
          aria-label="Close voice assistant"
        >
          <X className="h-5 w-5" />
        </motion.button>

        <div className="w-full h-full" style={{ pointerEvents: 'none' }}>
          <WiredOverlayContent
            isMobile={isMobile}
            onClose={onClose}
            onStateChange={onStateChange}
            isClosing={isClosing}
          />
        </div>
      </div>
    </>,
    document.body
  );
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function VoiceOverlay({ isOpen, onClose, onStateChange }: VoiceOverlayProps) {
  const isMobile = useIsMobile();
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, EXIT_ANIMATION_MS);
  }, [isClosing, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <VoiceErrorBoundary onReset={onClose}>
      <OverlayPortal
        isOpen={isOpen}
        isClosing={isClosing}
        onClose={handleClose}
        onStateChange={onStateChange}
        isMobile={isMobile}
      />
    </VoiceErrorBoundary>
  );
}
