import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from 'react';
import {
  DEFAULT_VOLUME,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_TTS_ENABLED,
  DEFAULT_AUTO_LISTEN,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_EXPRESSIVENESS,
  DEFAULT_RESPONSE_LENGTH,
  DEFAULT_SHOW_PIPELINE_METRICS,
  DEFAULT_PIPELINE_METRICS_AUTO_HIDE_MS,
  DEFAULT_SPEECH_THRESHOLD,
  DEFAULT_PAUSE_TOLERANCE_MS,
  DEFAULT_BARGE_IN_THRESHOLD,
  DEFAULT_PANEL_COLLAPSE_TIMEOUT_MS,
  DEFAULT_STT_TIMEOUT_MS,
  DEFAULT_TTS_TIMEOUT_MS,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_MIN_AUDIO_RMS,
  DEFAULT_MAX_HISTORY_MESSAGES,
  DEFAULT_LANGUAGE,
} from '@unctad-ai/voice-agent-core';

export interface VoiceSettings {
  volume: number;
  playbackSpeed: number;
  ttsEnabled: boolean;
  autoListen: boolean;
  idleTimeoutMs: number;
  expressiveness: number;
  responseLength: number;
  showPipelineMetrics: boolean;
  pipelineMetricsAutoHideMs: number;
  speechThreshold: number;
  pauseToleranceMs: number;
  bargeInThreshold: number;
  panelCollapseTimeoutMs: number;
  sttTimeoutMs: number;
  ttsTimeoutMs: number;
  llmTimeoutMs: number;
  minAudioRms: number;
  maxHistoryMessages: number;
  language: string;
}

const DEFAULTS: VoiceSettings = {
  volume: DEFAULT_VOLUME,
  playbackSpeed: DEFAULT_PLAYBACK_SPEED,
  ttsEnabled: DEFAULT_TTS_ENABLED,
  autoListen: DEFAULT_AUTO_LISTEN,
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  expressiveness: DEFAULT_EXPRESSIVENESS,
  responseLength: DEFAULT_RESPONSE_LENGTH,
  showPipelineMetrics: DEFAULT_SHOW_PIPELINE_METRICS,
  pipelineMetricsAutoHideMs: DEFAULT_PIPELINE_METRICS_AUTO_HIDE_MS,
  speechThreshold: DEFAULT_SPEECH_THRESHOLD,
  pauseToleranceMs: DEFAULT_PAUSE_TOLERANCE_MS,
  bargeInThreshold: DEFAULT_BARGE_IN_THRESHOLD,
  panelCollapseTimeoutMs: DEFAULT_PANEL_COLLAPSE_TIMEOUT_MS,
  sttTimeoutMs: DEFAULT_STT_TIMEOUT_MS,
  ttsTimeoutMs: DEFAULT_TTS_TIMEOUT_MS,
  llmTimeoutMs: DEFAULT_LLM_TIMEOUT_MS,
  minAudioRms: DEFAULT_MIN_AUDIO_RMS,
  maxHistoryMessages: DEFAULT_MAX_HISTORY_MESSAGES,
  language: DEFAULT_LANGUAGE,
};

const STORAGE_KEY = 'voice-settings';

function loadSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Merge with defaults to handle missing keys from older versions
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistSettings(settings: VoiceSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

interface VoiceSettingsContextType {
  settings: VoiceSettings;
  volumeRef: React.RefObject<number>;
  speedRef: React.RefObject<number>;
  updateSetting: <K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => void;
  resetSettings: () => void;
}

const VoiceSettingsContext = createContext<VoiceSettingsContextType | undefined>(undefined);

export function VoiceSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<VoiceSettings>(loadSettings);

  // Refs for hot-path audio — avoids re-renders on volume/speed drag
  const volumeRef = useRef(settings.volume);
  const speedRef = useRef(settings.playbackSpeed);

  const updateSetting = useCallback(
    <K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        persistSettings(next);
        // Keep refs in sync
        if (key === 'volume') volumeRef.current = value as number;
        if (key === 'playbackSpeed') speedRef.current = value as number;
        return next;
      });
    },
    []
  );

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULTS };
    setSettings(defaults);
    persistSettings(defaults);
    volumeRef.current = defaults.volume;
    speedRef.current = defaults.playbackSpeed;
  }, []);

  return (
    <VoiceSettingsContext.Provider
      value={{ settings, volumeRef, speedRef, updateSetting, resetSettings }}
    >
      {children}
    </VoiceSettingsContext.Provider>
  );
}

/**
 * Access voice settings. Returns defaults if Provider is absent
 * (needed for error boundary paths where the tree may be partial).
 */
export function useVoiceSettings(): VoiceSettingsContextType {
  const context = useContext(VoiceSettingsContext);
  if (context) return context;

  // Fallback — return static defaults (no persistence, no-op updates)
  return {
    settings: DEFAULTS,
    volumeRef: { current: DEFAULTS.volume },
    speedRef: { current: DEFAULTS.playbackSpeed },
    updateSetting: () => {},
    resetSettings: () => {},
  };
}
