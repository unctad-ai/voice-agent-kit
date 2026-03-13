/**
 * Voice settings that control pipeline behavior.
 * In host apps, these typically come from a VoiceSettingsContext/provider.
 * The core useVoiceAgent hook accepts them as injected parameters
 * (rather than importing a context) to keep core free of UI concerns.
 */
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
