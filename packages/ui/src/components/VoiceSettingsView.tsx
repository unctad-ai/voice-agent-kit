import { motion } from 'motion/react';
import {
  ArrowLeft,
  RotateCcw,
  Volume2,
  Gauge,
  AudioLines,
  Sparkles,
  Mic,
  Timer,
  MessageSquare,
  Activity,
  EyeOff,
  Info,
  Ear,
  Clock,
  Zap,
  Minimize2,
  Signal,
} from 'lucide-react';
import { useVoiceSettings } from '../contexts/VoiceSettingsContext';
import { VAD, useSiteConfig } from '@voice-agent/core';

interface VoiceSettingsViewProps {
  onBack: () => void;
  onVolumeChange?: (v: number) => void;
}

function expressivenessLabel(v: number): string {
  if (v <= 0.15) return 'Low';
  if (v <= 0.4) return 'Medium';
  return 'High';
}

function speechThresholdLabel(v: number): string {
  if (v >= 0.75) return 'Strict';
  if (v >= 0.5) return 'Balanced';
  return 'Sensitive';
}

function bargeInLabel(v: number): string {
  if (v >= 0.8) return 'Hard';
  if (v >= 0.6) return 'Normal';
  return 'Easy';
}

/** Slider setting row */
function SliderSetting({
  icon,
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-3 space-y-2.5">
      <div className="flex items-center gap-3">
        {icon}
        <span className="flex-1 text-sm font-medium text-neutral-900">{label}</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--voice-settings-accent, #DB2129)' }}>{displayValue}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: 'var(--voice-settings-accent, #DB2129)' }}
      />
    </div>
  );
}

/** Toggle setting row */
function ToggleSetting({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="py-3 flex items-center gap-3 cursor-pointer">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-neutral-900">{label}</div>
        <div className="text-xs text-neutral-500">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer"
        style={{ backgroundColor: checked ? 'var(--voice-settings-accent, #DB2129)' : '#d1d5db' }}
      >
        <span
          className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
        />
      </button>
    </label>
  );
}

/** Select setting row */
function SelectSetting({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="py-3 flex items-center gap-3">
      {icon}
      <span className="flex-1 text-sm font-medium text-neutral-900">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs rounded-lg border border-neutral-200 bg-neutral-50 px-2 outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function VoiceSettingsView({ onBack, onVolumeChange }: VoiceSettingsViewProps) {
  const { settings, updateSetting, resetSettings } = useVoiceSettings();
  const { colors } = useSiteConfig();
  const iconClass = 'w-4 h-4 shrink-0';
  const iconStyle = { color: colors.primary };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="voice-settings absolute inset-0 flex flex-col z-10"
      style={{ borderRadius: 'inherit', backgroundColor: '#f9fafb', '--voice-settings-accent': colors.primary } as React.CSSProperties}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 shrink-0 px-4"
        style={{ height: 56, borderBottom: '1px solid #e5e7eb' }}
      >
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors"
          style={{ color: '#6b7280' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#111827';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#6b7280';
          }}
          aria-label="Back to conversation"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="flex-1 text-sm font-semibold" style={{ color: '#111827' }}>
          Settings
        </span>
        <button
          onClick={resetSettings}
          className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors"
          style={{ color: '#9ca3af' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = colors.primary;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#9ca3af';
          }}
          aria-label="Reset all settings"
          title="Reset to defaults"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Voice Input */}
        <SettingsSection title="Voice Input">
          <ToggleSetting
            icon={<Mic className={iconClass} style={iconStyle} />}
            label="Auto-listen"
            description="Start mic when panel opens"
            checked={settings.autoListen}
            onChange={(v) => updateSetting('autoListen', v)}
          />
          <Divider />
          <SelectSetting
            icon={<Timer className={iconClass} style={iconStyle} />}
            label="Idle timeout"
            value={String(settings.idleTimeoutMs)}
            onChange={(v) => updateSetting('idleTimeoutMs', Number(v))}
            options={[
              { value: '30000', label: '30s' },
              { value: '60000', label: '1 min' },
              { value: '120000', label: '2 min' },
              { value: '300000', label: '5 min' },
            ]}
          />
          <Divider />
          <SliderSetting
            icon={<Ear className={iconClass} style={iconStyle} />}
            label="Speech threshold"
            value={settings.speechThreshold * 100}
            displayValue={speechThresholdLabel(settings.speechThreshold)}
            min={30}
            max={90}
            step={5}
            onChange={(v) => updateSetting('speechThreshold', v / 100)}
          />
          <Divider />
          <SelectSetting
            icon={<Clock className={iconClass} style={iconStyle} />}
            label="Pause tolerance"
            value={String(settings.pauseToleranceMs)}
            onChange={(v) => updateSetting('pauseToleranceMs', Number(v))}
            options={[
              { value: '400', label: 'Fast' },
              { value: '600', label: 'Default' },
              { value: '800', label: 'Relaxed' },
              { value: '1000', label: 'Patient' },
            ]}
          />
          <Divider />
          <SliderSetting
            icon={<Zap className={iconClass} style={iconStyle} />}
            label="Barge-in threshold"
            value={settings.bargeInThreshold * 100}
            displayValue={bargeInLabel(settings.bargeInThreshold)}
            min={40}
            max={90}
            step={5}
            onChange={(v) => updateSetting('bargeInThreshold', v / 100)}
          />
          <Divider />
          <SelectSetting
            icon={<Minimize2 className={iconClass} style={iconStyle} />}
            label="Auto-collapse"
            value={String(settings.panelCollapseTimeoutMs)}
            onChange={(v) => updateSetting('panelCollapseTimeoutMs', Number(v))}
            options={[
              { value: '120000', label: '2 min' },
              { value: '300000', label: '5 min' },
              { value: '600000', label: '10 min' },
              { value: '0', label: 'Never' },
            ]}
          />
        </SettingsSection>

        {/* Voice Output */}
        <SettingsSection title="Voice Output">
          <ToggleSetting
            icon={<AudioLines className={iconClass} style={iconStyle} />}
            label="Text-to-speech"
            description="Speak responses aloud"
            checked={settings.ttsEnabled}
            onChange={(v) => updateSetting('ttsEnabled', v)}
          />
          <Divider />
          <SliderSetting
            icon={<Volume2 className={iconClass} style={iconStyle} />}
            label="Volume"
            value={settings.volume * 100}
            displayValue={`${Math.round(settings.volume * 100)}%`}
            min={0}
            max={100}
            step={1}
            onChange={(v) => {
              updateSetting('volume', v / 100);
              onVolumeChange?.(v / 100);
            }}
          />
          <Divider />
          <SliderSetting
            icon={<Gauge className={iconClass} style={iconStyle} />}
            label="Speed"
            value={settings.playbackSpeed * 100}
            displayValue={`${settings.playbackSpeed.toFixed(2)}x`}
            min={75}
            max={150}
            step={5}
            onChange={(v) => updateSetting('playbackSpeed', v / 100)}
          />
          <Divider />
          <SliderSetting
            icon={<Sparkles className={iconClass} style={iconStyle} />}
            label="Expressiveness"
            value={settings.expressiveness * 100}
            displayValue={expressivenessLabel(settings.expressiveness)}
            min={10}
            max={60}
            step={5}
            onChange={(v) => updateSetting('expressiveness', v / 100)}
          />
          <Divider />
          <SelectSetting
            icon={<MessageSquare className={iconClass} style={iconStyle} />}
            label="Response length"
            value={String(settings.responseLength)}
            onChange={(v) => updateSetting('responseLength', Number(v))}
            options={[
              { value: '30', label: 'Brief' },
              { value: '60', label: 'Normal' },
              { value: '100', label: 'Detailed' },
            ]}
          />
        </SettingsSection>

        {/* Developer */}
        <SettingsSection title="Developer">
          <ToggleSetting
            icon={<Activity className={iconClass} style={iconStyle} />}
            label="Pipeline metrics"
            description="Show STT / LLM / TTS timings"
            checked={settings.showPipelineMetrics}
            onChange={(v) => updateSetting('showPipelineMetrics', v)}
          />
          <Divider />
          <SelectSetting
            icon={<EyeOff className={iconClass} style={iconStyle} />}
            label="Auto-hide metrics"
            value={String(settings.pipelineMetricsAutoHideMs)}
            onChange={(v) => updateSetting('pipelineMetricsAutoHideMs', Number(v))}
            options={[
              { value: '5000', label: '5s' },
              { value: '8000', label: '8s' },
              { value: '15000', label: '15s' },
              { value: '0', label: 'Never' },
            ]}
          />
          <Divider />
          <SelectSetting
            icon={<Mic className={iconClass} style={iconStyle} />}
            label="STT timeout"
            value={String(settings.sttTimeoutMs)}
            onChange={(v) => updateSetting('sttTimeoutMs', Number(v))}
            options={[
              { value: '10000', label: '10s' },
              { value: '15000', label: '15s' },
              { value: '30000', label: '30s' },
            ]}
          />
          <Divider />
          <SelectSetting
            icon={<AudioLines className={iconClass} style={iconStyle} />}
            label="TTS timeout"
            value={String(settings.ttsTimeoutMs)}
            onChange={(v) => updateSetting('ttsTimeoutMs', Number(v))}
            options={[
              { value: '30000', label: '30s' },
              { value: '55000', label: '55s' },
              { value: '90000', label: '90s' },
            ]}
          />
          <Divider />
          <SelectSetting
            icon={<Sparkles className={iconClass} style={iconStyle} />}
            label="LLM timeout"
            value={String(settings.llmTimeoutMs)}
            onChange={(v) => updateSetting('llmTimeoutMs', Number(v))}
            options={[
              { value: '10000', label: '10s' },
              { value: '20000', label: '20s' },
              { value: '30000', label: '30s' },
              { value: '60000', label: '60s' },
            ]}
          />
          <Divider />
          <SelectSetting
            icon={<Signal className={iconClass} style={iconStyle} />}
            label="Min audio level"
            value={String(settings.minAudioRms)}
            onChange={(v) => updateSetting('minAudioRms', Number(v))}
            options={[
              { value: '0.01', label: 'Sensitive' },
              { value: '0.02', label: 'Default' },
              { value: '0.035', label: 'Moderate' },
              { value: '0.05', label: 'Strict' },
            ]}
          />
        </SettingsSection>

        {/* Info */}
        <SettingsSection title="Info" last>
          <div className="py-3 flex items-start gap-3">
            <Info className={iconClass} style={{ ...iconStyle, marginTop: 2 }} />
            <div className="space-y-1 text-xs text-neutral-500">
              <div>
                VAD Threshold:{' '}
                <span className="font-medium text-neutral-700">{VAD.positiveSpeechThreshold}</span>
              </div>
            </div>
          </div>
        </SettingsSection>
      </div>
    </motion.div>
  );
}

function SettingsSection({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid #e5e7eb' }}>
      <div
        className="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: '#9ca3af' }}
      >
        {title}
      </div>
      <div className="px-4">{children}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: '#f3f4f6' }} />;
}
