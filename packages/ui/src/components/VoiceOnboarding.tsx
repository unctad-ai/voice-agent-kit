import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../utils';
import { useSiteConfig } from '@voice-agent/core';

const STORAGE_KEY = 'voice-onboarding-dismissed';

interface VoiceOnboardingProps {
  onTryNow: () => void;
  /** Custom description text shown in the onboarding tooltip */
  description?: string;
}

export default function VoiceOnboarding({ onTryNow, description }: VoiceOnboardingProps) {
  const { colors } = useSiteConfig();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      // Small delay so FAB renders first
      const timer = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, 'true');
  };

  const handleTryNow = () => {
    dismiss();
    onTryNow();
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className={cn(
            'fixed bottom-24 right-6 z-50',
            'md:bottom-[104px] md:right-6',
            'bg-white rounded-xl shadow-xl',
            'border border-neutral-200',
            'p-4 max-w-[280px]'
          )}
          role="tooltip"
        >
          {/* Arrow pointing down to FAB */}
          <div className="absolute -bottom-2 right-6 w-4 h-4 bg-white border-b border-r border-neutral-200 rotate-45" />

          <p className="text-sm text-neutral-700 leading-relaxed mb-3">
            {description ?? 'Meet your AI assistant. Ask about services, permits, or opportunities.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleTryNow}
              className={cn(
                'text-white text-sm font-medium',
                'rounded-lg px-3 py-1.5',
                'transition-colors cursor-pointer'
              )}
              style={{ backgroundColor: colors.primary }}
            >
              Try it now
            </button>
            <button
              onClick={dismiss}
              className={cn(
                'text-neutral-500 text-sm',
                'rounded-lg px-3 py-1.5',
                'hover:text-neutral-700 hover:bg-neutral-100',
                'transition-colors cursor-pointer'
              )}
            >
              Maybe later
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
