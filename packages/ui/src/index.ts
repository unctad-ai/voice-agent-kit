export { VoiceAgentProvider } from './VoiceAgentProvider';
export { VoiceSettingsProvider, useVoiceSettings } from './contexts/VoiceSettingsContext';
export type { VoiceSettings } from './contexts/VoiceSettingsContext';

// All components use default exports — re-export them as named
export { default as GlassCopilotPanel } from './components/GlassCopilotPanel';
export { default as AgentAvatar } from './components/AgentAvatar';
export { default as PipelineMetricsBar } from './components/PipelineMetricsBar';
export { default as VoiceA11yAnnouncer } from './components/VoiceA11yAnnouncer';
export { default as VoiceCopilotFAB } from './components/VoiceCopilotFAB';
export { default as VoiceControls } from './components/VoiceControls';
export { default as VoiceDotRing } from './components/VoiceDotRing';
export { default as VoiceErrorBoundary } from './components/VoiceErrorBoundary';
export { default as VoiceErrorDisplay } from './components/VoiceErrorDisplay';
export type { VoiceErrorType } from './components/VoiceErrorDisplay';
export { default as VoiceOnboarding } from './components/VoiceOnboarding';
export { default as VoiceOrb } from './components/VoiceOrb';
export { default as VoiceOverlay } from './components/VoiceOverlay';
export { default as VoiceSettingsView, SettingsSection, SliderSetting, ToggleSetting, SelectSetting, Divider } from './components/VoiceSettingsView';
export { PersonaSettings } from './components/PersonaSettings';
export { default as VoiceToolCard } from './components/VoiceToolCard';
export { default as VoiceTranscript } from './components/VoiceTranscript';
export { default as VoiceWaveformCanvas } from './components/VoiceWaveformCanvas';

// Utility
export { cn } from './utils';
