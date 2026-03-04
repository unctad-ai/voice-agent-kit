import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Keyboard, Send, X } from 'lucide-react';
import { cn } from '../utils';
import { useSiteConfig } from '@unctad-ai/voice-agent-core';
import type { VoiceState } from '@unctad-ai/voice-agent-core';

interface VoiceControlsProps {
  state: VoiceState;
  onTextSubmit: (text: string) => void;
  isListening: boolean;
}

const STATE_LABELS: Record<VoiceState, string> = {
  IDLE: 'How can I help you?',
  LISTENING: "I'm listening...",
  USER_SPEAKING: 'Go ahead...',
  PROCESSING: 'Let me look into that...',
  AI_SPEAKING: "Here's what I found...",
};

/** Shared glass-pill style for control buttons */
const GLASS_PILL_BASE = cn(
  'backdrop-blur-xl rounded-full',
  'flex items-center justify-center',
  'border border-white/15',
  'transition-all duration-200 cursor-pointer',
  'hover:border-white/30 hover:shadow-[0_0_16px_rgba(255,255,255,0.08)]'
);

export default function VoiceControls({ state, onTextSubmit, isListening }: VoiceControlsProps) {
  const { colors } = useSiteConfig();
  const [showTextInput, setShowTextInput] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showTextInput) inputRef.current?.focus();
  }, [showTextInput]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onTextSubmit(trimmed);
    setText('');
    setShowTextInput(false);
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-auto pb-8 px-4">
      <AnimatePresence mode="wait">
        {showTextInput ? (
          <motion.div
            key="text-input"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'rounded-full',
              'flex items-center gap-4',
              'border border-white/20',
              'px-8 py-3'
            )}
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(16px) saturate(1.2)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Ask a question..."
              className="flex-1 text-sm placeholder:text-white/40 min-w-0"
              style={{
                color: 'white',
                background: 'none',
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                WebkitAppearance: 'none',
                padding: 0,
              }}
            />
            <motion.button
              onClick={handleSubmit}
              whileTap={{ scale: 0.9 }}
              className="rounded-full p-2 text-white transition-colors cursor-pointer"
              style={{ backgroundColor: colors.primary }}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </motion.button>
            <button
              onClick={() => {
                setShowTextInput(false);
                setText('');
              }}
              className="rounded-full p-2 text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              aria-label="Cancel text input"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="controls"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center justify-center gap-3"
          >
            {/* Mic status + keyboard — unified control bar */}
            <div
              className={cn(
                'rounded-full',
                'text-white text-sm font-medium',
                'flex items-center gap-6',
                'border border-white/20',
                'pl-8 pr-4 py-1.5'
              )}
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                backdropFilter: 'blur(16px) saturate(1.2)',
                WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
                color: 'white',
              }}
            >
              {/* Pulse dot */}
              <span className="relative flex items-center justify-center w-3 h-3 ml-0.5">
                {isListening && (
                  <span
                    className="absolute inset-0 rounded-full animate-ping"
                    style={{ backgroundColor: `${colors.primary}80` }}
                  />
                )}
                <span
                  className={cn(
                    'relative h-2.5 w-2.5 rounded-full transition-colors duration-300',
                  )}
                  style={isListening ? {
                    backgroundColor: colors.primary,
                    boxShadow: `0 0 8px ${colors.primary}99`,
                  } : {
                    backgroundColor: 'rgba(255,255,255,0.3)',
                  }}
                />
              </span>
              {/* Animated label */}
              <AnimatePresence mode="wait">
                <motion.span
                  key={state}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="pr-1"
                >
                  {STATE_LABELS[state]}
                </motion.span>
              </AnimatePresence>

              {/* Type button — integrated into the bar */}
              <button
                onClick={() => setShowTextInput(true)}
                className={cn(
                  'rounded-full p-2',
                  'text-white/60 hover:text-white',
                  'hover:bg-white/10',
                  'transition-all duration-200 cursor-pointer'
                )}
                aria-label="Type a message"
              >
                <Keyboard className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
