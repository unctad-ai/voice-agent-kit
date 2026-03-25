import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  Cpu,
  EyeOff,
  Info,
  Ear,
  Clock,
  Zap,
  Minimize2,
  Signal,
  History,
  ChevronDown,
  User,
  MessageCircle,
  Headphones,
  SlidersHorizontal,
  Wrench,
  Globe,
  Palette,
  Type,
  TextCursorInput,
  Sparkle,
} from 'lucide-react';
import { useVoiceSettings } from '../contexts/VoiceSettingsContext';
import { VAD, useSiteConfig, usePersonaContext } from '@unctad-ai/voice-agent-core';
import { PersonaSettings } from './PersonaSettings.js';
import { Lock, Unlock } from 'lucide-react';

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

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'sw', label: 'Swahili' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'dz', label: 'Dzongkha' },
];

/** Inline style tag for custom range slider — injected once */
let sliderStylesInjected = false;
function ensureSliderStyles() {
  if (sliderStylesInjected || typeof document === 'undefined') return;
  sliderStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    input[type="range"].voice-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: #e5e7eb;
      outline: none;
      cursor: pointer;
      margin: 6px 0;
    }
    input[type="range"].voice-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--voice-settings-accent, #DB2129);
      border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
      cursor: pointer;
      transition: transform 0.1s ease;
      margin-top: -6px;
    }
    input[type="range"].voice-slider::-webkit-slider-thumb:hover {
      transform: scale(1.15);
    }
    input[type="range"].voice-slider::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--voice-settings-accent, #DB2129);
      border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
      cursor: pointer;
    }
    input[type="range"].voice-slider::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 2px;
      display: flex;
      align-items: center;
    }
    input[type="range"].voice-slider::-moz-range-track {
      height: 4px;
      border-radius: 2px;
      background: #e5e7eb;
    }
  `;
  document.head.appendChild(style);
}

/** Slider setting row */
export function SliderSetting({
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
  ensureSliderStyles();
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div style={{ paddingTop: 12, paddingBottom: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {icon}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#111827' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--voice-settings-accent, #DB2129)' }}>{displayValue}</span>
      </div>
      <input
        type="range"
        className="voice-slider"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--voice-settings-accent, #DB2129) 0%, var(--voice-settings-accent, #DB2129) ${pct}%, #e5e7eb ${pct}%, #e5e7eb 100%)`,
        }}
      />
    </div>
  );
}

/** Toggle setting row */
export function ToggleSetting({
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
    <label style={{ paddingTop: 12, paddingBottom: 12, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          width: 44,
          height: 24,
          borderRadius: 9999,
          backgroundColor: checked ? 'var(--voice-settings-accent, #DB2129)' : '#d1d5db',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 20,
            height: 20,
            borderRadius: 9999,
            backgroundColor: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transition: 'transform 0.2s',
            transform: checked ? 'translateX(22px)' : 'translateX(2px)',
          }}
        />
      </button>
    </label>
  );
}

/** Select setting row */
export function SelectSetting({
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
    <div style={{ paddingTop: 12, paddingBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      {icon}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#111827', minWidth: 0 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = '#d1d5db';
          e.currentTarget.style.backgroundColor = '#f3f4f6';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = '#e5e7eb';
          e.currentTarget.style.backgroundColor = '#f9fafb';
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#9ca3af'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
        style={{
          height: 34,
          lineHeight: '34px',
          fontSize: 12,
          fontWeight: 500,
          color: '#374151',
          borderRadius: 9999,
          border: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          paddingTop: 0,
          paddingBottom: 0,
          paddingLeft: 12,
          paddingRight: 28,
          outline: 'none',
          WebkitAppearance: 'none',
          appearance: 'none',
          cursor: 'pointer',
          flexShrink: 0,
          width: 110,
          transition: 'border-color 0.15s, background-color 0.15s',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
        }}
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

/** Text input setting row — saves on blur, matches SelectSetting visual style */
function TextInputSetting({
  icon,
  label,
  description,
  value,
  onSave,
  multiline,
  rows = 2,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  value: string;
  onSave: (v: string) => Promise<boolean> | void;
  multiline?: boolean;
  rows?: number;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  useEffect(() => { setLocal(value); }, [value]);

  useEffect(() => {
    if (saveStatus === 'saved') {
      const t = setTimeout(() => setSaveStatus('idle'), 1500);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  const handleBlur = async () => {
    setFocused(false);
    if (local !== value) {
      const ok = await onSave(local);
      if (typeof ok === 'boolean') setSaveStatus(ok ? 'saved' : 'error');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    fontSize: 12,
    fontWeight: 500,
    color: '#374151',
    padding: '6px 10px',
    borderRadius: 8,
    border: `1px solid ${focused ? '#9ca3af' : '#e5e7eb'}`,
    backgroundColor: '#f9fafb',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    resize: multiline ? 'vertical' : 'none',
    transition: 'border-color 0.15s',
  };

  return (
    <div style={{ paddingTop: 10, paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {icon}
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
            {label}
            <AnimatePresence>
              {saveStatus === 'saved' && (
                <motion.span key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} style={{ marginLeft: 6, fontSize: 11, color: '#22c55e', fontWeight: 400 }}>Saved</motion.span>
              )}
              {saveStatus === 'error' && (
                <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} style={{ marginLeft: 6, fontSize: 11, color: '#ef4444', fontWeight: 400 }}>Save failed</motion.span>
              )}
            </AnimatePresence>
          </span>
          {description && <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>{description}</p>}
        </div>
      </div>
      {multiline ? (
        <textarea
          value={local}
          onChange={(e) => { setLocal(e.target.value); if (saveStatus === 'error') setSaveStatus('idle'); }}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          rows={rows}
          style={inputStyle}
        />
      ) : (
        <input
          type="text"
          value={local}
          onChange={(e) => { setLocal(e.target.value); if (saveStatus === 'error') setSaveStatus('idle'); }}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          style={inputStyle}
        />
      )}
    </div>
  );
}

/** Color picker setting row */
function ColorInputSetting({
  icon,
  label,
  value,
  onSave,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onSave: (v: string) => Promise<boolean> | void;
}) {
  const [local, setLocal] = useState(value);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  useEffect(() => { setLocal(value); }, [value]);

  useEffect(() => {
    if (saveStatus === 'saved') {
      const t = setTimeout(() => setSaveStatus('idle'), 1500);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  const handleBlur = async () => {
    if (local !== value) {
      const ok = await onSave(local);
      if (typeof ok === 'boolean') setSaveStatus(ok ? 'saved' : 'error');
    }
  };

  return (
    <div style={{ paddingTop: 12, paddingBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      {icon}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#111827' }}>
        {label}
        <AnimatePresence>
          {saveStatus === 'saved' && (
            <motion.span key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} style={{ marginLeft: 6, fontSize: 11, color: '#22c55e', fontWeight: 400 }}>Saved</motion.span>
          )}
          {saveStatus === 'error' && (
            <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} style={{ marginLeft: 6, fontSize: 11, color: '#ef4444', fontWeight: 400 }}>Save failed</motion.span>
          )}
        </AnimatePresence>
      </span>
      <input
        type="color"
        value={local}
        onChange={(e) => { setLocal(e.target.value); if (saveStatus === 'error') setSaveStatus('idle'); }}
        onBlur={handleBlur}
        style={{ width: 34, height: 28, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', padding: 0 }}
      />
    </div>
  );
}

export default function VoiceSettingsView({ onBack, onVolumeChange }: VoiceSettingsViewProps) {
  const { settings, updateSetting, resetSettings } = useVoiceSettings();
  const config = useSiteConfig();
  const persona = usePersonaContext();
  const { colors } = config;
  const [openSection, setOpenSection] = useState<string | null>(null);
  const iconStyle = { width: 16, height: 16, flexShrink: 0, color: colors.primary };
  const sectionIconStyle = { width: 16, height: 16, flexShrink: 0, color: colors.primary };
  const sectionProps = (id: string) => ({
    open: openSection === id,
    onToggle: () => setOpenSection(openSection === id ? null : id),
  });

  // Admin auth state — lifted here so the toggle lives in the footer
  const [adminPassword, setAdminPassword] = useState<string | null>(
    () => sessionStorage.getItem('voice-admin-pw')
  );
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const isAdmin = adminPassword !== null;

  const updateConfigFn = persona?.updateConfig;
  const handleSharedSave = useCallback(async (fields: Record<string, string>): Promise<boolean> => {
    if (!adminPassword || !updateConfigFn) return false;
    try { await updateConfigFn(fields, adminPassword); return true; }
    catch (err) { console.error('Settings save failed:', err); return false; }
  }, [adminPassword, updateConfigFn]);

  const handleAdminLogin = useCallback(async (pw: string) => {
    if (!persona) return;
    try {
      await persona.updateConfig({}, pw);
      sessionStorage.setItem('voice-admin-pw', pw);
      setAdminPassword(pw);
      setAuthError('');
      setShowPasswordInput(false);
      setPasswordInput('');
    } catch {
      setAuthError('Invalid password');
    }
  }, [persona]);

  const handleAdminToggle = useCallback(() => {
    if (isAdmin) {
      sessionStorage.removeItem('voice-admin-pw');
      setAdminPassword(null);
      setShowPasswordInput(false);
      setPasswordInput('');
    } else {
      setShowPasswordInput(true);
    }
  }, [isAdmin]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        borderRadius: 'inherit',
        backgroundColor: '#f9fafb',
        fontFamily: 'inherit',
        '--voice-settings-accent': colors.primary,
      } as React.CSSProperties}
    >
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, paddingLeft: 16, paddingRight: 16, height: 56, borderBottom: '1px solid #e5e7eb' }}
      >
        <button
          onClick={onBack}
          style={{ width: 32, height: 32, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'color 0.15s', color: '#6b7280', background: 'none', border: 'none' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#111827';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#6b7280';
          }}
          aria-label="Back to conversation"
        >
          <ArrowLeft style={{ width: 16, height: 16 }} />
        </button>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#111827' }}>
          Settings
        </span>
        <button
          onClick={resetSettings}
          style={{ width: 32, height: 32, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'color 0.15s', color: '#9ca3af', background: 'none', border: 'none' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = colors.primary;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#9ca3af';
          }}
          aria-label="Reset all settings"
          title="Reset to defaults"
        >
          <RotateCcw style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Agent Persona */}
        {config.personaEndpoint && (
          <SettingsSection title="Persona" icon={<User style={sectionIconStyle} />} {...sectionProps('persona')}>
            <PersonaSettings adminPassword={adminPassword} />
          </SettingsSection>
        )}

        {/* Agent Configuration (admin-only) */}
        {config.personaEndpoint && isAdmin && persona?.persona && (
          <SettingsSection title="Agent" icon={<Sparkle style={sectionIconStyle} />} {...sectionProps('agent')}>
            <TextInputSetting
              icon={<Type style={iconStyle} />}
              label="Portal context"
              description="What this portal offers — helps the AI understand the domain"
              value={persona.persona.siteTitle || config.siteTitle || ''}
              onSave={(v) => handleSharedSave({ siteTitle: v })}
            />
            <Divider />
            <TextInputSetting
              icon={<MessageSquare style={iconStyle} />}
              label="Greeting"
              description="Shown when the panel opens with no conversation"
              value={persona.persona.greetingMessage || config.greetingMessage || ''}
              onSave={(v) => handleSharedSave({ greetingMessage: v })}
              multiline
            />
            <Divider />
            <TextInputSetting
              icon={<TextCursorInput style={iconStyle} />}
              label="Suggested prompts"
              description="Tappable chips in the empty state (one per line)"
              value={persona.persona.suggestedPrompts || config.suggestedPrompts?.join('\n') || ''}
              onSave={(v) => handleSharedSave({ suggestedPrompts: v })}
              multiline
              rows={3}
            />
            <Divider />
            <TextInputSetting
              icon={<Info style={iconStyle} />}
              label="System prompt intro"
              description="Prefixed to every LLM conversation. Use {name} for the agent's name."
              value={persona.persona.systemPromptIntro || config.systemPromptIntro || ''}
              onSave={(v) => handleSharedSave({ systemPromptIntro: v })}
              multiline
              rows={4}
            />
            <Divider />
            <SelectSetting
              icon={<Globe style={iconStyle} />}
              label="Default language"
              value={persona.persona.language || config.language || 'en'}
              onChange={(v) => handleSharedSave({ language: v })}
              options={LANGUAGE_OPTIONS}
            />
          </SettingsSection>
        )}

        {/* Conversation */}
        <SettingsSection title="Conversation" icon={<MessageCircle style={sectionIconStyle} />} {...sectionProps('conversation')}>
          <SelectSetting
            icon={<MessageSquare style={iconStyle} />}
            label="Response length"
            value={String(settings.responseLength)}
            onChange={(v) => updateSetting('responseLength', Number(v))}
            options={[
              { value: '30', label: 'Brief' },
              { value: '60', label: 'Normal' },
              { value: '100', label: 'Detailed' },
            ]}
          />
          <Divider />
          <SelectSetting
            icon={<History style={iconStyle} />}
            label="Chat memory"
            value={String(settings.maxHistoryMessages)}
            onChange={(v) => updateSetting('maxHistoryMessages', Number(v))}
            options={[
              { value: '10', label: '10 msgs' },
              { value: '20', label: '20 msgs' },
              { value: '30', label: '30 msgs' },
              { value: '40', label: '40 msgs' },
            ]}
          />
        </SettingsSection>

        {/* Listening */}
        <SettingsSection title="Listening" icon={<Headphones style={sectionIconStyle} />} {...sectionProps('listening')}>
          <SelectSetting
            icon={<Globe style={iconStyle} />}
            label="Language"
            value={settings.language}
            onChange={(v) => updateSetting('language', v)}
            options={LANGUAGE_OPTIONS}
          />
          <Divider />
          <ToggleSetting
            icon={<Mic style={iconStyle} />}
            label="Auto-listen"
            description="Start mic when panel opens"
            checked={settings.autoListen}
            onChange={(v) => updateSetting('autoListen', v)}
          />
          <Divider />
          <SliderSetting
            icon={<Ear style={iconStyle} />}
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
            icon={<Clock style={iconStyle} />}
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
            icon={<Zap style={iconStyle} />}
            label="Barge-in threshold"
            value={settings.bargeInThreshold * 100}
            displayValue={bargeInLabel(settings.bargeInThreshold)}
            min={40}
            max={90}
            step={5}
            onChange={(v) => updateSetting('bargeInThreshold', v / 100)}
          />
        </SettingsSection>

        {/* Speaking */}
        <SettingsSection title="Speaking" icon={<Volume2 style={sectionIconStyle} />} {...sectionProps('speaking')}>
          <ToggleSetting
            icon={<AudioLines style={iconStyle} />}
            label="Text-to-speech"
            description="Speak responses aloud"
            checked={settings.ttsEnabled}
            onChange={(v) => updateSetting('ttsEnabled', v)}
          />
          <Divider />
          <SliderSetting
            icon={<Volume2 style={iconStyle} />}
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
            icon={<Gauge style={iconStyle} />}
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
            icon={<Sparkles style={iconStyle} />}
            label="Expressiveness"
            value={settings.expressiveness * 100}
            displayValue={expressivenessLabel(settings.expressiveness)}
            min={10}
            max={60}
            step={5}
            onChange={(v) => updateSetting('expressiveness', v / 100)}
          />
        </SettingsSection>

        {/* Behavior */}
        <SettingsSection title="Behavior" icon={<SlidersHorizontal style={sectionIconStyle} />} {...sectionProps('behavior')}>
          <SelectSetting
            icon={<Timer style={iconStyle} />}
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
          <SelectSetting
            icon={<Minimize2 style={iconStyle} />}
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

        {/* Developer */}
        <SettingsSection title="Developer" icon={<Wrench style={sectionIconStyle} />} {...sectionProps('developer')} last>
          <ToggleSetting
            icon={<Activity style={iconStyle} />}
            label="Pipeline metrics"
            description="Show STT / LLM / TTS timings"
            checked={settings.showPipelineMetrics}
            onChange={(v) => updateSetting('showPipelineMetrics', v)}
          />
          <Divider />
          <SelectSetting
            icon={<EyeOff style={iconStyle} />}
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
            icon={<Mic style={iconStyle} />}
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
            icon={<AudioLines style={iconStyle} />}
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
            icon={<Cpu style={iconStyle} />}
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
            icon={<Signal style={iconStyle} />}
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
          <Divider />
          <div style={{ paddingTop: 8, paddingBottom: 4, fontSize: 11, color: '#9ca3af' }}>
            VAD Threshold: <span style={{ fontWeight: 500, color: '#6b7280' }}>{VAD.positiveSpeechThreshold}</span>
          </div>
        </SettingsSection>
      </div>

      {/* Footer — admin toggle + kit version */}
      <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 11, color: '#9ca3af', borderTop: '1px solid #f3f4f6' }}>
        {showPasswordInput ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', padding: '4px 0' }}>
            <input
              type="text"
              placeholder="Admin password"
              value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setAuthError(''); }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdminLogin(passwordInput);
                if (e.key === 'Escape') { setShowPasswordInput(false); setPasswordInput(''); setAuthError(''); }
              }}
              autoFocus
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 6,
                border: `1px solid ${authError ? '#ef4444' : '#e5e7eb'}`,
                outline: 'none', fontFamily: 'inherit', width: 110,
                WebkitTextSecurity: 'disc',
              } as React.CSSProperties}
            />
            <button
              onClick={() => handleAdminLogin(passwordInput)}
              style={{
                fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 6,
                border: 'none', backgroundColor: '#1f2937', color: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >OK</button>
            <button
              onClick={() => { setShowPasswordInput(false); setPasswordInput(''); setAuthError(''); }}
              style={{ fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
            >Cancel</button>
            {authError && <span style={{ fontSize: 10, color: '#ef4444' }}>{authError}</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {config.personaEndpoint ? (
              <button
                onClick={handleAdminToggle}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, color: isAdmin ? colors.primary : '#9ca3af',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', padding: 0, transition: 'color 0.15s',
                }}
              >
                {isAdmin
                  ? <><Unlock style={{ width: 12, height: 12 }} /> Admin mode</>
                  : <><Lock style={{ width: 12, height: 12 }} /> Admin mode</>
                }
              </button>
            ) : <span />}
            <span>Kit v<span style={{ fontWeight: 500, color: '#6b7280' }}>{__KIT_VERSION__}</span></span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function SettingsSection({
  title,
  icon,
  children,
  last,
  open = false,
  onToggle,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid #e5e7eb' }}>
      <button
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 14,
          paddingBottom: 14,
          backgroundColor: hovered ? '#edf0f3' : open ? '#f0f2f5' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'background-color 0.15s',
        }}
      >
        {icon}
        <span style={{
          flex: 1,
          textAlign: 'left',
          fontSize: 13,
          fontWeight: 600,
          color: '#374151',
        }}>{title}</span>
        <ChevronDown style={{
          width: 14,
          height: 14,
          color: '#9ca3af',
          transition: 'transform 0.2s ease',
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
        }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 4,
              paddingBottom: 12,
              backgroundColor: '#fff',
              borderTop: '1px solid #e5e7eb',
            }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 1, backgroundColor: '#f3f4f6' }} />;
}
