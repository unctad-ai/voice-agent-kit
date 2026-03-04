import { useEffect, useRef } from 'react';
import type { OrbState } from '@unctad-ai/voice-agent-core';

interface VoiceA11yAnnouncerProps {
  isOpen: boolean;
  orbState: OrbState;
}

const STATE_ANNOUNCEMENTS: Record<OrbState, string> = {
  idle: 'Voice assistant ready',
  listening: 'Listening for your question',
  processing: 'Processing your request',
  speaking: 'Assistant is responding',
  error: 'An error occurred',
};

export default function VoiceA11yAnnouncer({ isOpen, orbState }: VoiceA11yAnnouncerProps) {
  const prevOpen = useRef(isOpen);
  const prevState = useRef(orbState);
  const announceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!announceRef.current) return;

    if (isOpen && !prevOpen.current) {
      announceRef.current.textContent =
        'Voice assistant opened. Press Escape to close. Use Ctrl+Shift+V to toggle.';
    } else if (!isOpen && prevOpen.current) {
      announceRef.current.textContent = 'Voice assistant closed';
    } else if (isOpen && orbState !== prevState.current) {
      announceRef.current.textContent = STATE_ANNOUNCEMENTS[orbState];
    }

    prevOpen.current = isOpen;
    prevState.current = orbState;
  }, [isOpen, orbState]);

  return (
    <div
      ref={announceRef}
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      role="status"
    />
  );
}
