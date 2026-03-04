import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Mic } from 'lucide-react';
import { useSiteConfig } from '@voice-agent/core';

interface VoiceCopilotFABProps {
  onClick: () => void;
  isActive?: boolean;
  isOverlayOpen?: boolean;
  onMouseEnter?: () => void;
}

export default function VoiceCopilotFAB({
  onClick,
  isActive,
  isOverlayOpen,
  onMouseEnter,
}: VoiceCopilotFABProps) {
  const prefersReduced = useReducedMotion();
  const { colors } = useSiteConfig();

  return (
    <AnimatePresence>
      {!isOverlayOpen && (
        <motion.div
          key="voice-fab-wrapper"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-6 right-6 z-50"
        >
          <motion.button
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            animate={prefersReduced ? {} : { scale: [1, 1.15, 1] }}
            transition={
              prefersReduced
                ? {}
                : { scale: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } }
            }
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="relative rounded-full p-3 shadow-lg text-white transition-all cursor-pointer"
            style={{ backgroundColor: colors.primary }}
            aria-label="Open voice assistant"
          >
            {isActive ? (
              <span className="h-3 w-3 rounded-full bg-white animate-pulse" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
