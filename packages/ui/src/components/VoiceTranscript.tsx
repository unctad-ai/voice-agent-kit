import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils';
import {
  MAX_VISIBLE_MESSAGES,
  MAX_TEXT_LENGTH,
  TYPEWRITER_DELAY_MS,
  MIN_DISPLAY_LENGTH,
  PANEL_MAX_VISIBLE_MESSAGES,
  PANEL_MAX_TEXT_LENGTH,
  DEFAULT_FONT_FAMILY,
  useSiteConfig,
} from '@unctad-ai/voice-agent-core';
import type { VoiceMessage, ActionCategory } from '@unctad-ai/voice-agent-core';
import type { VoiceErrorType } from './VoiceErrorDisplay';
import { ArrowRight, PenLine, MousePointerClick, Search, Info, ChevronDown } from 'lucide-react';

/** Strip markdown/HTML artifacts, TTS paralinguistic tags, and emojis — preserves line breaks */
function cleanForDisplay(text: string): string {
  return text
    .replace(/\[(laugh|chuckle|sigh|gasp|cough|clear throat|sniff|groan|shush)\]/gi, '') // TTS paralinguistic tags
    .replace(/\*\*(.*?)\*\*/g, '$1') // **bold** → bold
    .replace(/^\s*\*\s+/gm, '- ') // * list items → dash lists
    .replace(/\*(.*?)\*/g, '$1') // *italic* → italic
    .replace(/`([^`]+)`/g, '$1') // `code` → code
    .replace(/^#{1,6}\s+/gm, '') // # headings → plain text
    .replace(/<br\s*\/?>/gi, '\n') // <br> → newline
    .replace(/<[^>]+>/g, '') // strip remaining HTML tags
    .replace(/\|[-:\s|]+\|/g, '') // table separator rows
    .replace(/\|/g, '\n') // | cell dividers → newlines
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, '') // strip emojis
    .replace(/[ \t]{3,}/g, '  ') // collapse horizontal whitespace (preserve \n)
    .replace(/\n{3,}/g, '\n\n') // collapse 3+ newlines to double
    .replace(/^[\s-]{3,}$/gm, '') // --- horizontal rules
    .trim();
}

/** Render cleaned text with line breaks and styled list items */
function FormattedText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length <= 1) {
    return (
      <p className={className} style={style}>
        {text}
      </p>
    );
  }

  return (
    <div className={className} style={style}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const isListItem = /^\d+[.)]\s/.test(trimmed) || /^[-]\s/.test(trimmed);
        return (
          <p
            key={i}
            style={{
              marginTop: i === 0 ? 0 : isListItem ? 4 : 8,
              paddingLeft: isListItem ? 8 : 0,
            }}
          >
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

interface VoiceTranscriptProps {
  messages: VoiceMessage[];
  isTyping: boolean;
  /** When true, uses minimal text layout (no glass background) for the panel */
  variant?: 'overlay' | 'panel';
  /** When set, replaces the empty-state placeholder with a prominent error message */
  voiceError?: VoiceErrorType;
}

/** Progressively reveals words while preserving FormattedText structure */
function TypewriterFormattedText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [visibleWords, setVisibleWords] = useState(0);
  const words = text.split(' ');

  useEffect(() => {
    setVisibleWords(0);
    if (words.length === 0) return;

    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleWords(i);
      if (i >= words.length) clearInterval(interval);
    }, TYPEWRITER_DELAY_MS);

    return () => clearInterval(interval);
  }, [text, words.length]);

  const partialText = words.slice(0, visibleWords).join(' ');
  return <FormattedText text={partialText} className={className} style={style} />;
}

// ---------------------------------------------------------------------------
// Action Badge — colors aligned to design system
// ---------------------------------------------------------------------------

// Subtle tints from project palette — same low-opacity family, gentle differentiation
const ACTION_CATEGORY_STYLES: Record<
  ActionCategory,
  { bg: string; border: string; text: string; Icon: typeof ArrowRight }
> = {
  navigation: {
    bg: 'rgba(45,134,89,0.07)',
    border: 'rgba(45,134,89,0.14)',
    text: 'rgba(31,110,71,0.75)',
    Icon: ArrowRight,
  },
  form: {
    bg: 'rgba(110,114,138,0.07)',
    border: 'rgba(110,114,138,0.14)',
    text: 'rgba(85,88,102,0.75)',
    Icon: PenLine,
  },
  ui: {
    bg: 'rgba(141,145,168,0.07)',
    border: 'rgba(141,145,168,0.14)',
    text: 'rgba(85,88,102,0.75)',
    Icon: MousePointerClick,
  },
  search: {
    bg: 'rgba(219,33,41,0.05)',
    border: 'rgba(219,33,41,0.11)',
    text: 'rgba(168,26,31,0.7)',
    Icon: Search,
  },
  info: {
    bg: 'rgba(172,176,195,0.08)',
    border: 'rgba(172,176,195,0.14)',
    text: 'rgba(110,114,138,0.7)',
    Icon: Info,
  },
};

const BADGE_CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-start',
};
const BADGE_TRANSITION = { duration: 0.2, ease: 'easeOut' as const };

function ActionBadge({ msg, count = 1 }: { msg: VoiceMessage; count?: number }) {
  const category = msg.action?.category ?? 'info';
  const styles = ACTION_CATEGORY_STYLES[category];
  const { Icon } = styles;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={BADGE_TRANSITION}
      style={BADGE_CONTAINER_STYLE}
      role="status"
      aria-label={count > 1 ? `${msg.text} (${count} times)` : msg.text}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full"
        style={{
          padding: '3px 10px',
          fontSize: '11px',
          fontWeight: 500,
          lineHeight: '1.3',
          color: styles.text,
          backgroundColor: styles.bg,
          border: `1px solid ${styles.border}`,
        }}
      >
        <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
        {msg.text}
        {count > 1 && (
          <span
            className="inline-flex items-center justify-center rounded-full"
            style={{
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              fontSize: '10px',
              fontWeight: 600,
              lineHeight: 1,
              color: styles.text,
              backgroundColor: styles.text.replace(/[\d.]+\)$/, '0.10)'),
            }}
          >
            {count}x
          </span>
        )}
      </span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Group consecutive action badges by action name
// ---------------------------------------------------------------------------

type DisplayItem =
  | { type: 'message'; msg: VoiceMessage }
  | { type: 'action'; msg: VoiceMessage; count: number };

function groupDisplayItems(messages: VoiceMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role !== 'action') {
      items.push({ type: 'message', msg });
      continue;
    }
    const prev = items[items.length - 1];
    if (prev?.type === 'action' && prev.msg.action?.name === msg.action?.name) {
      prev.count++;
      prev.msg = msg; // keep latest text/timestamp for display
    } else {
      items.push({ type: 'action', msg, count: 1 });
    }
  }
  return items;
}

/** Filter out noise, protocol leaks, and very short fragments */
function isDisplayWorthy(msg: VoiceMessage): boolean {
  if (msg.role === 'action') return msg.text.trim().length > 0;
  const t = msg.text.trim();
  if (t.length < MIN_DISPLAY_LENGTH) return false;
  const alphaOnly = t.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (alphaOnly.length === 0) return false;
  return true;
}

export default function VoiceTranscript({
  messages,
  isTyping,
  variant = 'overlay',
  voiceError,
}: VoiceTranscriptProps) {
  const config = useSiteConfig();
  const fontFamily = config.fontFamily ?? DEFAULT_FONT_FAMILY;
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanel = variant === 'panel';
  const maxVisible = isPanel ? PANEL_MAX_VISIBLE_MESSAGES : MAX_VISIBLE_MESSAGES;
  const maxTextLen = isPanel ? PANEL_MAX_TEXT_LENGTH : MAX_TEXT_LENGTH;
  const visible = messages.filter(isDisplayWorthy).slice(-maxVisible);

  // Track whether user has manually scrolled away from bottom
  const userScrolledRef = useRef(false);
  const lastMessageCountRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showNewMessagePill, setShowNewMessagePill] = useState(false);

  // Detect manual scroll: if user scrolls up, stop auto-scrolling; clear pill when at bottom
  useEffect(() => {
    if (!isPanel) return;
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      userScrolledRef.current = !atBottom;
      if (atBottom) setShowNewMessagePill(false);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [isPanel]);

  // Scroll to bottom on new messages, or show pill if user has scrolled away
  useEffect(() => {
    if (!isPanel) return;
    if (visible.length > lastMessageCountRef.current) {
      if (userScrolledRef.current) {
        setShowNewMessagePill(true);
      } else {
        requestAnimationFrame(() => {
          const el = containerRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    }
    lastMessageCountRef.current = visible.length;
  }, [visible.length, isPanel]);

  // Auto-scroll whenever content height changes (typewriter words, streaming, new messages)
  useEffect(() => {
    if (!isPanel) return;
    const contentEl = contentRef.current;
    const scrollEl = containerRef.current;
    if (!contentEl || !scrollEl) return;
    const observer = new ResizeObserver(() => {
      if (!userScrolledRef.current) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    });
    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [isPanel]);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      userScrolledRef.current = false;
      setShowNewMessagePill(false);
    }
  };

  if (isPanel) {
    return (
      <div className="flex-1 min-h-0 relative" style={{ fontFamily }}>
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-y-auto overscroll-contain"
          style={{
            padding: '16px 16px 12px',
            maskImage:
              'linear-gradient(to bottom, transparent 0%, black 8px, black calc(100% - 8px), transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0%, black 8px, black calc(100% - 8px), transparent 100%)',
          }}
        >
        <div ref={contentRef} className="flex flex-col" style={{ paddingBottom: '24px' }}>
          <AnimatePresence mode="popLayout">
            {groupDisplayItems(visible).map((item, idx, arr) => {
              if (item.type === 'action') {
                // Show "Copilot" label before first action in a group
                const prevIsAction = idx > 0 && arr[idx - 1].type === 'action';
                const showLabel = !prevIsAction;
                return (
                  <motion.div
                    key={item.msg.timestamp}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      marginTop: idx === 0 ? 0 : prevIsAction ? 4 : 12,
                    }}
                  >
                    {showLabel && (
                      <p
                        className="uppercase tracking-wider"
                        style={{
                          fontSize: '10px',
                          fontWeight: 500,
                          letterSpacing: '0.06em',
                          color: 'rgba(0,0,0,0.35)',
                          marginBottom: '4px',
                        }}
                      >
                        Copilot
                      </p>
                    )}
                    <ActionBadge msg={item.msg} count={item.count} />
                  </motion.div>
                );
              }

              const { msg } = item;
              const isLast = idx === arr.length - 1;
              const isAI = msg.role === 'assistant';

              const cleaned = cleanForDisplay(msg.text);
              const displayText =
                cleaned.length > maxTextLen
                  ? cleaned.slice(0, maxTextLen).trimEnd() + '...'
                  : cleaned;

              return (
                <motion.div
                  key={msg.timestamp}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isAI ? 'flex-start' : 'flex-end',
                    marginTop: idx === 0 ? 0 : 12,
                  }}
                >
                  <p
                    className="uppercase tracking-wider"
                    style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      letterSpacing: '0.06em',
                      color: isAI ? 'rgba(0,0,0,0.35)' : 'rgba(219,33,41,0.5)',
                      marginBottom: '4px',
                    }}
                  >
                    {isAI ? 'Copilot' : 'You'}
                  </p>
                  <div
                    style={{
                      ...(isAI
                        ? {}
                        : {
                            backgroundColor: 'rgba(219,33,41,0.07)',
                            border: '1px solid rgba(219,33,41,0.12)',
                            borderRadius: '14px 14px 4px 14px',
                            padding: '10px 14px',
                            maxWidth: '88%',
                          }),
                    }}
                  >
                    {isAI && isLast && isTyping ? (
                      <TypewriterFormattedText
                        text={displayText}
                        
                        style={{
                          fontSize: '14px',
                          fontWeight: 400,
                          lineHeight: '1.45',
                          color: '#1a1a1a',
                        }}
                      />
                    ) : (
                      <FormattedText
                        text={displayText}
                        
                        style={{
                          fontSize: '14px',
                          fontWeight: isAI ? 400 : 450,
                          lineHeight: '1.45',
                          color: isAI ? '#1a1a1a' : '#3d0a0b',
                        }}
                      />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {visible.length === 0 &&
            !isTyping &&
            (voiceError === 'llm_failed' || voiceError === 'network_error' ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.15 }}
                className="text-center"
                style={{ paddingTop: '48px', paddingBottom: '16px' }}
              >
                <div
                  className="mx-auto rounded-full flex items-center justify-center"
                  style={{
                    width: 48,
                    height: 48,
                    backgroundColor: 'rgba(220, 38, 38, 0.08)',
                    marginBottom: '14px',
                  }}
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(220,38,38,0.6)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                    <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                    <line x1="12" y1="20" x2="12.01" y2="20" />
                  </svg>
                </div>
                <p
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'rgba(0,0,0,0.7)',
                    marginBottom: '6px',
                  }}
                >
                  Service offline
                </p>
                <p
                  style={{
                    fontSize: '13px',
                    color: 'rgba(0,0,0,0.4)',
                    lineHeight: '1.4',
                    maxWidth: '240px',
                    margin: '0 auto',
                  }}
                >
                  The AI assistant is currently unavailable. Please try again shortly.
                </p>
              </motion.div>
            ) : (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className="text-center italic"
                style={{ fontSize: '14px', color: 'rgba(0,0,0,0.4)', paddingTop: '60px' }}
              >
                Ask me anything
              </motion.p>
            ))}

          {isTyping && visible.length === 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              style={{ color: 'rgba(0,0,0,0.4)', fontSize: '14px' }}
            >
              ...
            </motion.p>
          )}
        </div>
      </div>
      <AnimatePresence>
        {showNewMessagePill && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            onClick={scrollToBottom}
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 12px 5px 10px',
              fontSize: 11,
              fontWeight: 500,
              color: 'rgba(0,0,0,0.6)',
              backgroundColor: 'rgba(255,255,255,0.92)',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 9999,
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              zIndex: 1,
            }}
          >
            <ChevronDown size={12} strokeWidth={2.5} />
            New message
          </motion.button>
        )}
      </AnimatePresence>
      </div>
    );
  }

  // Original overlay variant (unchanged)
  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-md text-center rounded-2xl overflow-hidden"
      style={{ fontFamily }}
    >
      {/* Glass refraction layer */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          filter: 'url(#liquid-glass-orb)',
          isolation: 'isolate',
        }}
      />
      {/* Glass surface */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.6)',
          border: '1px solid rgba(255, 255, 255, 0.4)',
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.05), inset 0 0 20px -5px rgba(255, 255, 255, 0.5)',
        }}
      />
      {/* Specular highlight */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 40%)',
        }}
      />
      {/* Content */}
      <div className="relative flex flex-col gap-2 px-6 py-4">
        <AnimatePresence mode="popLayout">
          {groupDisplayItems(visible).map((item, idx, arr) => {
            if (item.type === 'action') {
              const prevIsAction = idx > 0 && arr[idx - 1].type === 'action';
              return (
                <div key={item.msg.timestamp} style={{ marginTop: prevIsAction ? -4 : 0 }}>
                  <ActionBadge msg={item.msg} count={item.count} />
                </div>
              );
            }

            const { msg } = item;
            const isLatest = idx === arr.length - 1;
            const isAI = msg.role === 'assistant';
            const isFading = idx < arr.length - 1;

            const displayText =
              msg.text.length > maxTextLen
                ? msg.text.slice(0, maxTextLen).trimEnd() + '...'
                : msg.text;

            return (
              <motion.p
                key={msg.timestamp}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: isFading ? 0.5 : 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className={cn('text-lg leading-relaxed', isAI ? '' : 'italic')}
                style={{
                  color: isAI ? '#1a1a1a' : 'rgba(0,0,0,0.7)',
                }}
              >
                {isAI && isLatest && isTyping ? (
                  <TypewriterFormattedText text={displayText} />
                ) : (
                  displayText
                )}
              </motion.p>
            );
          })}
        </AnimatePresence>

        {visible.length === 0 && !isTyping && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-lg italic"
            style={{ color: 'rgba(0,0,0,0.5)' }}
          >
            Ask me anything
          </motion.p>
        )}

        {isTyping && visible.length === 0 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            className="text-black/50 text-lg"
          >
            ...
          </motion.p>
        )}
      </div>
    </div>
  );
}
