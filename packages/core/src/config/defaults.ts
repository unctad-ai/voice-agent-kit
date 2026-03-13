import type { ActionCategory, OrbState } from '../types/voice';
import type { VoiceThresholds } from '../types/config';

// ---------------------------------------------------------------------------
// Audio & Speech Detection
// ---------------------------------------------------------------------------

export const VAD = {
  hopSize: 256,
  threshold: 0.5,
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 600,
  minSpeechMs: 500,
  preSpeechPadMs: 400,
} as const;

export const MIN_AUDIO_RMS = 0.02;
export const MAX_NO_SPEECH_PROB = 0.6;
export const MIN_AVG_LOGPROB = -0.7;

export const BARGE_IN = {
  threshold: 0.7,
  framesRequired: 5,
} as const;

// ---------------------------------------------------------------------------
// Pipeline Behavior
// ---------------------------------------------------------------------------

export const SILENT_MARKER = '[SILENT]';
export const END_SESSION_MARKER = '[END_SESSION]';

export const MIC_TOGGLE_DEBOUNCE_MS = 300;
export const GUARD_DELAY_MS = 200;
export const MAX_STT_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 500;
export const MISFIRE_DISMISS_MS = 2500;
export const LLM_ERROR_DISMISS_MS = 4000;
export const LLM_RESPONSE_TIMEOUT_MS = 20_000;
export const PIPELINE_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Network Timeouts
// ---------------------------------------------------------------------------

export const HEALTH_CHECK_TIMEOUT_MS = 6_000;
export const STT_TIMEOUT_MS = 15_000;
export const TTS_TIMEOUT_MS = 55_000;
export const RECOVERY_POLL_MS = 30_000;

// ---------------------------------------------------------------------------
// Overlay & Idle
// ---------------------------------------------------------------------------

export const IDLE_TIMEOUT_MS = 60_000;
export const WIND_DOWN_MS = 10_000;
export const EXIT_ANIMATION_MS = 550;

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export const MAX_VISIBLE_MESSAGES = 2;
export const MAX_TEXT_LENGTH = 180;
export const TYPEWRITER_DELAY_MS = 30;
export const MIN_DISPLAY_LENGTH = 10;

// ---------------------------------------------------------------------------
// Waveform Canvas
// ---------------------------------------------------------------------------

export const WAVEFORM_NUM_BARS = 64;
export const WAVEFORM_MIN_BAR_HEIGHT = 5;
export const WAVEFORM_MAX_BAR_HEIGHT = 40;
export const WAVEFORM_GAP = 12;
export const WAVEFORM_SMOOTHING = 0.15;

// ---------------------------------------------------------------------------
// Orb Animation
// ---------------------------------------------------------------------------

export const ORB_NUM_POINTS = 10;
export const ORB_LERP_SPEED = 0.06;

// ---------------------------------------------------------------------------
// Glass Copilot Panel
// ---------------------------------------------------------------------------

export const MIC_IDLE_TIMEOUT_MS = 60_000;
export const PANEL_COLLAPSE_TIMEOUT_MS = 300_000;
export const SHOW_PIPELINE_METRICS = false;
export const PIPELINE_METRICS_AUTO_HIDE_MS = 8_000;

export const PANEL_WIDTH = 392;
export const PANEL_COLLAPSED_HEIGHT = 64;
export const PANEL_EXPANDED_HEIGHT = 480;
export const PANEL_BORDER_RADIUS = 26;
export const PANEL_BOTTOM = 24;
export const PANEL_RIGHT = 24;
export const PANEL_Z_INDEX = 2147483646;

export const SPRING_PANEL = { type: 'spring' as const, stiffness: 320, damping: 34, mass: 1.0 };
export const SPRING_CONTENT = { type: 'spring' as const, stiffness: 340, damping: 32, mass: 0.7 };
export const SPRING_MICRO = { type: 'spring' as const, stiffness: 500, damping: 30, mass: 0.5 };
export const SPRING_PANEL_EXIT = { type: 'spring' as const, stiffness: 380, damping: 38, mass: 0.8 };

export const PANEL_MAX_VISIBLE_MESSAGES = 50;
export const PANEL_MAX_TEXT_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Streaming TTS Playback
// ---------------------------------------------------------------------------

export const TTS_STREAM_CHUNK_MS = 250;
export const WAV_HEADER_SIZE = 44;

// ---------------------------------------------------------------------------
// Action Badge Config
// ---------------------------------------------------------------------------

export const ACTION_BADGE_CONFIG: Record<string, { category: ActionCategory; label: string }> = {
  navigateTo: { category: 'navigation', label: 'Navigated' },
  viewService: { category: 'navigation', label: 'Opened service' },
  startApplication: { category: 'navigation', label: 'Started application' },
  searchServices: { category: 'search', label: 'Searched services' },
  getServiceDetails: { category: 'info', label: 'Fetched details' },
  listServicesByCategory: { category: 'info', label: 'Listed services' },
  compareServices: { category: 'info', label: 'Compared services' },
  recommendServices: { category: 'info', label: 'Recommendations' },
  getFormSchema: { category: 'form', label: 'Reading form' },
  fillFormFields: { category: 'form', label: 'Form fill' },
  performUIAction: { category: 'ui', label: 'Action' },
};

// ---------------------------------------------------------------------------
// Voice Settings Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_VOLUME = 1.0;
export const DEFAULT_PLAYBACK_SPEED = 1.0;
export const DEFAULT_TTS_ENABLED = true;
export const DEFAULT_AUTO_LISTEN = true;
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_EXPRESSIVENESS = 0.3;
export const DEFAULT_RESPONSE_LENGTH = 60;
export const DEFAULT_SHOW_PIPELINE_METRICS = false;
export const DEFAULT_PIPELINE_METRICS_AUTO_HIDE_MS = 8_000;
export const DEFAULT_SPEECH_THRESHOLD = 0.6;
export const DEFAULT_PAUSE_TOLERANCE_MS = 600;
export const DEFAULT_BARGE_IN_THRESHOLD = 0.7;
export const DEFAULT_PANEL_COLLAPSE_TIMEOUT_MS = 300_000;
export const DEFAULT_STT_TIMEOUT_MS = 15_000;
export const DEFAULT_TTS_TIMEOUT_MS = 55_000;
export const DEFAULT_LLM_TIMEOUT_MS = 20_000;
export const DEFAULT_MIN_AUDIO_RMS = 0.02;
export const DEFAULT_MAX_HISTORY_MESSAGES = 20;
export const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_FONT_FAMILY = 'DM Sans, sans-serif';

// ---------------------------------------------------------------------------
// Dot Ring
// ---------------------------------------------------------------------------

export const DOT_RING_COUNT = 24;
export const DOT_RING_GAP = 6;
export const DOT_RING_BASE_RADIUS = 2;
export const DOT_RING_PEAK_RADIUS = 4;
export const DOT_RING_SMOOTHING = 0.12;

// ---------------------------------------------------------------------------
// Agent Avatar
// ---------------------------------------------------------------------------

export const AVATAR_PORTRAIT_RATIO = 0.88;

export const AVATAR_STATE_FILTERS: Record<
  OrbState,
  { brightness: number; saturate: number; opacity: number; scale: number; glowIntensity: number }
> = {
  idle: { brightness: 0.92, saturate: 0.85, opacity: 0.95, scale: 1.0, glowIntensity: 0 },
  listening: { brightness: 1.1, saturate: 1.15, opacity: 1.0, scale: 1.02, glowIntensity: 0.12 },
  processing: { brightness: 1.0, saturate: 1.0, opacity: 0.92, scale: 1.0, glowIntensity: 0.08 },
  speaking: { brightness: 1.08, saturate: 1.1, opacity: 1.0, scale: 1.0, glowIntensity: 0.1 },
  error: { brightness: 0.75, saturate: 0.6, opacity: 0.88, scale: 0.98, glowIntensity: 0.18 },
};

// ---------------------------------------------------------------------------
// Default Thresholds (overridable via SiteConfig.thresholdOverrides)
// ---------------------------------------------------------------------------

export const DEFAULT_THRESHOLDS: VoiceThresholds = {
  positiveSpeechThreshold: 0.6,
  negativeSpeechThreshold: 0.35,
  minSpeechFrames: 5,
  preSpeechPadFrames: 3,
  redemptionFrames: 5,
  minAudioRms: 0.02,
  maxNoSpeechProb: 0.6,
  minAvgLogprob: -0.7,
};

/** Build glow colors from SiteConfig.colors at runtime */
export function buildGlowColors(colors: { primary: string; processing: string; speaking: string; error?: string }): Record<OrbState, string> {
  return {
    idle: 'transparent',
    listening: colors.primary,
    processing: colors.processing,
    speaking: colors.speaking,
    error: colors.error ?? '#DC2626',
  };
}
