import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersonaContext, useSiteConfig, useVoiceRecorder } from '@unctad-ai/voice-agent-core';
import type { QualityWarning } from '@unctad-ai/voice-agent-core';

const RECORDING_PROMPTS = [
  'Good morning. I am here to help you with your registration process today.',
  'Could you please provide your business name and the type of license you need?',
  'Thank you for your patience. Your application has been submitted successfully.',
];

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

export function PersonaSettings({ adminPassword }: { adminPassword?: string | null }) {
  const config = useSiteConfig();
  if (!config.personaEndpoint) return null;

  return <PersonaSettingsInner adminPassword={adminPassword ?? null} />;
}

function PersonaSettingsInner({ adminPassword }: { adminPassword: string | null }) {
  const config = useSiteConfig();
  const persona = usePersonaContext();
  const [showRecording, setShowRecording] = useState(false);

  const isAdmin = adminPassword !== null;

  const updateConfigFn = persona?.updateConfig;
  const handleSharedSave = useCallback(async (fields: Record<string, string>) => {
    if (!adminPassword || !updateConfigFn) return;
    try {
      await updateConfigFn(fields, adminPassword);
    } catch (err) {
      console.error('Settings save failed:', err);
    }
  }, [adminPassword, updateConfigFn]);

  if (!persona) return null;
  const { persona: data, isLoaded, uploadAvatar, uploadVoice, deleteVoice, setActiveVoice, previewVoice, updateConfig } = persona;

  if (!isLoaded) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: '#9ca3af', fontFamily: 'inherit' }}>
        Loading persona settings...
      </div>
    );
  }

  // Full-panel recording flow
  if (showRecording) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'inherit' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Record voice sample</span>
        <RecordingFlow
          onComplete={async (blob, name) => {
            const file = new File([blob], `${name}.wav`, { type: 'audio/wav' });
            await uploadVoice(file, name, adminPassword ?? undefined);
            setShowRecording(false);
          }}
          onCancel={() => setShowRecording(false)}
          primaryColor={config.colors.primary}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'inherit' }}>
      {isAdmin ? (
        <>
          <AvatarSection avatarUrl={config.avatarUrl} name={config.copilotName} onUpload={(f) => uploadAvatar(f, adminPassword)} />
          <NameSection name={config.copilotName} onSave={(n) => updateConfig({ copilotName: n }, adminPassword)} primaryColor={config.colors.primary} />
          <VoiceSection
            voices={data?.voices ?? []}
            activeVoiceId={data?.activeVoiceId ?? ''}
            onUpload={(f, n) => uploadVoice(f, n, adminPassword)}
            onDelete={(id) => deleteVoice(id, adminPassword)}
            onSelect={(id) => setActiveVoice(id, adminPassword)}
            onPreview={previewVoice}
            primaryColor={config.colors.primary}
            onRecord={() => setShowRecording(true)}
          />

          {/* Shared settings */}
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Copilot settings</span>

            <ColorSettingRow
              label="Color"
              value={data?.copilotColor || config.colors.primary || '#1B5E20'}
              onSave={v => handleSharedSave({ copilotColor: v })}
            />

            <TextSettingRow
              label="Site title"
              value={data?.siteTitle || ''}
              onSave={v => handleSharedSave({ siteTitle: v })}
            />

            <TextAreaSettingRow
              label="Greeting"
              value={data?.greetingMessage || ''}
              onSave={v => handleSharedSave({ greetingMessage: v })}
            />

            <TextAreaSettingRow
              label="Farewell"
              value={data?.farewellMessage || ''}
              onSave={v => handleSharedSave({ farewellMessage: v })}
            />

            <TextAreaSettingRow
              label="System prompt intro"
              value={data?.systemPromptIntro || ''}
              onSave={v => handleSharedSave({ systemPromptIntro: v })}
              rows={4}
            />

            <TextAreaSettingRow
              label="Suggested prompts (one per line)"
              value={data?.suggestedPrompts || ''}
              onSave={v => handleSharedSave({ suggestedPrompts: v })}
              rows={3}
            />

            <SettingRow label="Default language">
              <select
                value={data?.language || 'en'}
                onChange={e => handleSharedSave({ language: e.target.value })}
                style={{
                  fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb',
                  padding: '4px 8px', outline: 'none', fontFamily: 'inherit',
                  backgroundColor: '#fff',
                }}
              >
                {LANGUAGE_OPTIONS.map(l => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </SettingRow>
          </div>

        </>
      ) : (
        <>
          {/* Read-only view */}
          <AvatarSection avatarUrl={config.avatarUrl} name={config.copilotName} disabled />
          <div style={{ fontSize: 13, color: '#6b7280', padding: '4px 0' }}>
            <span style={{ fontWeight: 500, color: '#111827' }}>Name:</span> {config.copilotName}
          </div>
          <VoiceSection
            voices={data?.voices ?? []}
            activeVoiceId={data?.activeVoiceId ?? ''}
            onUpload={(f, n) => uploadVoice(f, n)}
            onDelete={(id) => deleteVoice(id)}
            onSelect={setActiveVoice}
            onPreview={previewVoice}
            primaryColor={config.colors.primary}
            disabled
          />
        </>
      )}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#6b7280', minWidth: 90 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function ColorSettingRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <SettingRow label={label}>
      <input type="color"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onSave(local); }}
        style={{ width: 32, height: 26, border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer', padding: 0 }}
      />
    </SettingRow>
  );
}

function TextSettingRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <SettingRow label={label}>
      <input
        type="text"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onSave(local); }}
        style={{
          width: '100%', fontSize: 12, padding: '4px 8px', borderRadius: 6,
          border: '1px solid #e5e7eb', outline: 'none', fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
    </SettingRow>
  );
}

function TextAreaSettingRow({ label, value, onSave, rows = 2 }: {
  label: string; value: string; onSave: (v: string) => void; rows?: number;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#6b7280' }}>{label}</span>
      <textarea
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onSave(local); }}
        rows={rows}
        style={{
          width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6,
          border: '1px solid #e5e7eb', outline: 'none', fontFamily: 'inherit',
          resize: 'vertical', boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function AvatarSection({ avatarUrl, name, onUpload, disabled }: {
  avatarUrl?: string;
  name: string;
  onUpload?: (file: File) => Promise<void>;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = (name || '?')[0].toUpperCase();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image too large (max 5 MB)');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try { await onUpload(file); setImgError(false); }
    catch (err) { setUploadError(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploading(false); }
  };

  const showImage = avatarUrl && !imgError;
  const canEdit = !disabled && onUpload;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4, paddingBottom: 4 }}>
      <div
        onClick={() => canEdit && !uploading && inputRef.current?.click()}
        onMouseEnter={() => canEdit && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          width: 44,
          height: 44,
          borderRadius: 9999,
          overflow: 'hidden',
          backgroundColor: '#e5e7eb',
          flexShrink: 0,
          cursor: !canEdit ? 'default' : uploading ? 'wait' : 'pointer',
        }}
      >
        {showImage ? (
          <img
            src={avatarUrl}
            alt=""
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b7280',
            fontSize: 16,
            fontWeight: 600,
          }}>{initial}</div>
        )}
        {/* hover overlay */}
        {canEdit && hovered && !uploading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}>Edit</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Avatar</div>
        <div style={{ fontSize: 11, color: uploadError ? '#DC2626' : '#6b7280' }}>
          {uploadError ?? (disabled ? '' : uploading ? 'Uploading...' : 'PNG, JPG or WebP (max 5 MB)')}
        </div>
      </div>
      {canEdit && <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} style={{ display: 'none' }} />}
    </div>
  );
}

function NameSection({ name, onSave, primaryColor }: {
  name: string;
  onSave: (name: string) => Promise<void>;
  primaryColor: string;
}) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [saveHovered, setSaveHovered] = useState(false);
  const dirty = value !== name;

  useEffect(() => { setValue(name); }, [name]);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(value); }
    catch (err) { console.error('Name update failed:', err); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, paddingBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Name</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          maxLength={30}
          style={{
            flex: 1,
            fontSize: 13,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: 8,
            border: `1px solid ${inputFocused ? '#9ca3af' : '#e5e7eb'}`,
            backgroundColor: '#fff',
            outline: 'none',
            fontFamily: 'inherit',
            transition: 'border-color 0.15s',
          }}
        />
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            onMouseEnter={() => setSaveHovered(true)}
            onMouseLeave={() => setSaveHovered(false)}
            style={{
              fontSize: 12,
              fontWeight: 500,
              paddingLeft: 12,
              paddingRight: 12,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 8,
              border: 'none',
              backgroundColor: saveHovered ? primaryColor : '#1f2937',
              color: '#fff',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.5 : 1,
              transition: 'background-color 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}

function VoiceSection({ voices, activeVoiceId, onUpload, onDelete, onSelect, onPreview, primaryColor, disabled, onRecord }: {
  voices: { id: string; name: string }[];
  activeVoiceId: string;
  onUpload: (file: File, name: string) => Promise<any>;
  onDelete: (id: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onPreview: (id: string, text: string) => Promise<ArrayBuffer>;
  primaryColor: string;
  disabled?: boolean;
  onRecord?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileRef.current = file;
    setUploadName(file.name.replace(/\.wav$/i, ''));
    setShowUpload(true);
  };

  const handleUpload = async () => {
    if (!fileRef.current || !uploadName) return;
    setUploading(true);
    try {
      await onUpload(fileRef.current, uploadName);
      setShowUpload(false);
      setUploadName('');
      fileRef.current = null;
    } catch (err) {
      console.error('Voice upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (voiceId: string) => {
    setPreviewing(voiceId);
    try {
      const buffer = await onPreview(voiceId, 'Hello, I am your AI assistant. How can I help you today?');
      const blob = new Blob([buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewing(null); };
      audio.play();
    } catch (err) {
      console.error('Preview failed:', err);
      setPreviewing(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4, paddingBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Voice</span>

      {voices.length === 0 && (
        <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
          No voices configured. Record or upload a WAV sample to enable voice cloning.
        </p>
      )}

      {voices.map(v => (
        <VoiceRow
          key={v.id}
          voice={v}
          isActive={v.id === activeVoiceId}
          isPreviewing={previewing === v.id}
          onSelect={() => onSelect(v.id)}
          onPreview={() => handlePreview(v.id)}
          onDelete={disabled ? undefined : () => onDelete(v.id)}
          disabled={disabled}
          primaryColor={primaryColor}
        />
      ))}

      {!disabled && (
        showUpload ? (
          <UploadForm
            uploadName={uploadName}
            uploading={uploading}
            onNameChange={setUploadName}
            onUpload={handleUpload}
            onCancel={() => { setShowUpload(false); fileRef.current = null; }}
            primaryColor={primaryColor}
          />
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            {onRecord && (
              <DashedButton
                disabled={voices.length >= 10}
                onClick={onRecord}
                label="Record voice sample"
              />
            )}
            <DashedButton
              disabled={voices.length >= 10}
              onClick={() => inputRef.current?.click()}
              label="Upload WAV (max 45s)"
            />
          </div>
        )
      )}

      {!disabled && <input ref={inputRef} type="file" accept="audio/wav" onChange={handleFileSelect} style={{ display: 'none' }} />}
    </div>
  );
}

function VoiceRow({ voice, isActive, isPreviewing, onSelect, onPreview, onDelete, primaryColor, disabled }: {
  voice: { id: string; name: string };
  isActive: boolean;
  isPreviewing: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onDelete?: () => void;
  primaryColor: string;
  disabled?: boolean;
}) {
  const [previewHovered, setPreviewHovered] = useState(false);
  const [deleteHovered, setDeleteHovered] = useState(false);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 8,
      paddingBottom: 8,
      borderRadius: 8,
      border: `1px solid ${isActive ? '#9ca3af' : '#e5e7eb'}`,
      backgroundColor: isActive ? '#f9fafb' : '#fff',
      fontSize: 13,
    }}>
      <input
        type="radio"
        name="active-voice"
        checked={isActive}
        onChange={onSelect}
        disabled={disabled}
        style={{ accentColor: primaryColor }}
      />
      <span style={{ flex: 1 }}>{voice.name}</span>
      <button
        onClick={onPreview}
        disabled={isPreviewing}
        onMouseEnter={() => setPreviewHovered(true)}
        onMouseLeave={() => setPreviewHovered(false)}
        style={{
          fontSize: 11,
          color: previewHovered ? '#374151' : '#6b7280',
          background: 'none',
          border: 'none',
          cursor: isPreviewing ? 'default' : 'pointer',
          opacity: isPreviewing ? 0.5 : 1,
          fontFamily: 'inherit',
          transition: 'color 0.15s',
        }}
      >
        {isPreviewing ? 'Playing...' : 'Preview'}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          onMouseEnter={() => setDeleteHovered(true)}
          onMouseLeave={() => setDeleteHovered(false)}
          style={{
            fontSize: 11,
            color: deleteHovered ? '#b91c1c' : '#ef4444',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'color 0.15s',
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}

function UploadForm({ uploadName, uploading, onNameChange, onUpload, onCancel, primaryColor }: {
  uploadName: string;
  uploading: boolean;
  onNameChange: (v: string) => void;
  onUpload: () => void;
  onCancel: () => void;
  primaryColor: string;
}) {
  const [uploadHovered, setUploadHovered] = useState(false);
  const [cancelHovered, setCancelHovered] = useState(false);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 10,
      borderRadius: 6,
      border: '1px solid #e5e7eb',
      backgroundColor: '#f9fafb',
    }}>
      <input
        type="text"
        value={uploadName}
        onChange={e => onNameChange(e.target.value)}
        placeholder="Voice name"
        style={{
          fontSize: 13,
          paddingLeft: 10,
          paddingRight: 10,
          paddingTop: 6,
          paddingBottom: 6,
          borderRadius: 6,
          border: '1px solid #e5e7eb',
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onUpload}
          disabled={uploading || !uploadName}
          onMouseEnter={() => setUploadHovered(true)}
          onMouseLeave={() => setUploadHovered(false)}
          style={{
            fontSize: 11,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 4,
            paddingBottom: 4,
            borderRadius: 6,
            border: 'none',
            backgroundColor: uploadHovered ? primaryColor : '#1f2937',
            color: '#fff',
            cursor: uploading || !uploadName ? 'default' : 'pointer',
            opacity: uploading || !uploadName ? 0.5 : 1,
            fontFamily: 'inherit',
            transition: 'background-color 0.15s',
          }}
        >
          {uploading ? 'Processing (~8s)...' : 'Upload'}
        </button>
        <button
          onClick={onCancel}
          onMouseEnter={() => setCancelHovered(true)}
          onMouseLeave={() => setCancelHovered(false)}
          style={{
            fontSize: 11,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 4,
            paddingBottom: 4,
            borderRadius: 6,
            border: '1px solid #e5e7eb',
            backgroundColor: cancelHovered ? '#f9fafb' : 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background-color 0.15s',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DashedButton({ disabled, onClick, label }: { disabled: boolean; onClick: () => void; label: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        fontSize: 11,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px dashed #d1d5db',
        backgroundColor: hovered && !disabled ? '#f9fafb' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.15s',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Recording Flow
// ---------------------------------------------------------------------------

function RecordingFlow({ onComplete, onCancel, primaryColor }: {
  onComplete: (blob: Blob, name: string) => Promise<void>;
  onCancel: () => void;
  primaryColor: string;
}) {
  const recorder = useVoiceRecorder();
  const [name, setName] = useState('Recording');
  const [uploading, setUploading] = useState(false);

  // Auto-prepare on mount
  useEffect(() => { recorder.prepare(); }, []);

  const handleUpload = async () => {
    if (!recorder.wavBlob) return;
    setUploading(true);
    try {
      await onComplete(recorder.wavBlob, name);
    } catch (err) {
      console.error('Voice upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  // Loading state
  if (recorder.loading) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#6b7280', textAlign: 'center', fontFamily: 'inherit' }}>
        Preparing microphone...
      </div>
    );
  }

  // Error state (WASM failed or mic denied)
  if (recorder.error) {
    return (
      <div style={{
        padding: 12, borderRadius: 8, border: '1px solid #fca5a5',
        backgroundColor: '#fef2f2', fontSize: 12, fontFamily: 'inherit',
      }}>
        <div style={{ color: '#dc2626', marginBottom: 8 }}>
          Could not access microphone. Please check your browser permissions.
        </div>
        <button onClick={onCancel} style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 6,
          border: '1px solid #e5e7eb', backgroundColor: '#fff',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Cancel</button>
      </div>
    );
  }

  // Ready state
  if (recorder.state === 'ready') {
    return (
      <div style={{
        padding: 12, borderRadius: 10, border: '1px solid #e5e7eb',
        backgroundColor: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 10,
        fontFamily: 'inherit',
      }}>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          Use a quiet room and speak naturally.
        </div>
        <PromptSentences />
        <LevelMeter rms={recorder.rmsLevel} active={false} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={recorder.startRecording} style={{
            flex: 1, padding: 8, borderRadius: 8, border: 'none',
            backgroundColor: '#dc2626', color: '#fff', fontSize: 12,
            fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#fff', display: 'inline-block',
            }} />
            Start recording
          </button>
          <button onClick={onCancel} style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
            backgroundColor: '#fff', fontSize: 12, color: '#6b7280',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
        </div>
      </div>
    );
  }

  // Recording state
  if (recorder.state === 'recording') {
    return (
      <div style={{
        padding: 12, borderRadius: 10, border: '1px solid #fca5a5',
        backgroundColor: '#fef2f2', display: 'flex', flexDirection: 'column', gap: 10,
        fontFamily: 'inherit',
      }}>
        <PromptSentences />
        <LevelMeter rms={recorder.rmsLevel} active elapsed={recorder.elapsed} maxDuration={45} />
        <button onClick={recorder.stop} style={{
          width: '100%', padding: 8, borderRadius: 8, border: 'none',
          backgroundColor: '#1f2937', color: '#fff', fontSize: 12,
          fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: 2,
            background: '#fff', display: 'inline-block',
          }} />
          Stop recording
        </button>
      </div>
    );
  }

  // Review state
  return (
    <div style={{
      padding: 12, borderRadius: 10, border: '1px solid #e5e7eb',
      backgroundColor: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 10,
      fontFamily: 'inherit',
    }}>
      <WaveformPreview blob={recorder.wavBlob} duration={recorder.elapsed} />
      <QualityBadge warning={recorder.qualityWarning} />
      <input
        type="text" value={name} onChange={e => setName(e.target.value)}
        placeholder="Voice name"
        style={{
          width: '100%', fontSize: 13, padding: '6px 10px', borderRadius: 8,
          border: '1px solid #e5e7eb', outline: 'none', fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        {(!recorder.qualityWarning?.blocking) && (
          <button onClick={handleUpload} disabled={uploading || !name} style={{
            flex: 1, padding: 8, borderRadius: 8, border: 'none',
            backgroundColor: '#1f2937', color: '#fff', fontSize: 12,
            fontWeight: 500, cursor: uploading || !name ? 'default' : 'pointer',
            opacity: uploading || !name ? 0.5 : 1, fontFamily: 'inherit',
          }}>
            {uploading ? 'Processing (~8s)...' : 'Use this recording'}
          </button>
        )}
        <button onClick={recorder.reset} style={{
          padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
          backgroundColor: '#fff', fontSize: 12, color: '#6b7280',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>Re-record</button>
      </div>
    </div>
  );
}

function PromptSentences() {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12,
    }}>
      <div style={{
        fontSize: 10, color: '#9ca3af', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 8,
      }}>Read aloud</div>
      {RECORDING_PROMPTS.map((sentence, i) => (
        <div key={i} style={{
          fontSize: 13, color: '#374151', lineHeight: 1.6,
          marginBottom: i < RECORDING_PROMPTS.length - 1 ? 6 : 0,
        }}>
          {i + 1}. &ldquo;{sentence}&rdquo;
        </div>
      ))}
      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 8, fontStyle: 'italic' }}>
        Pause briefly between each sentence.
      </div>
    </div>
  );
}

function LevelMeter({ rms, active, elapsed, maxDuration }: {
  rms: number; active?: boolean; elapsed?: number; maxDuration?: number;
}) {
  const color = active ? '#dc2626' : '#d1d5db';
  const barCount = 8;
  const heights = Array.from({ length: barCount }, (_, i) => {
    const base = Math.min(1, rms * 5);
    const variation = Math.sin(i * 1.7 + (elapsed ?? 0) * 3) * 0.3 + 0.7;
    return 4 + base * variation * 16;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 2, alignItems: 'end', height: 20 }}>
        {heights.map((h, i) => (
          <div key={i} style={{
            width: 3, height: h, backgroundColor: color, borderRadius: 1,
            transition: 'height 0.1s',
          }} />
        ))}
      </div>
      {active && elapsed != null && maxDuration != null ? (
        <>
          <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>
            {formatTime(elapsed)} / {formatTime(maxDuration)}
          </span>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', backgroundColor: '#dc2626',
            display: 'inline-block',
          }} />
        </>
      ) : (
        <span style={{ fontSize: 11, color: '#9ca3af' }}>Mic ready</span>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function WaveformPreview({ blob, duration }: { blob: Blob | null; duration: number }) {
  const [playing, setPlaying] = useState(false);
  const [bars, setBars] = useState<number[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const barCount = 60;
  useEffect(() => {
    if (!blob) return;
    blob.arrayBuffer().then(buf => {
      // Skip 44-byte WAV header, read Int16 samples
      const samples = new Int16Array(buf, 44);
      const chunkSize = Math.max(1, Math.floor(samples.length / barCount));
      const result: number[] = [];
      for (let i = 0; i < barCount; i++) {
        let maxAbs = 0;
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, samples.length);
        for (let j = start; j < end; j++) {
          const abs = Math.abs(samples[j]) / 32768;
          if (abs > maxAbs) maxAbs = abs;
        }
        result.push(maxAbs);
      }
      setBars(result);
    });
  }, [blob]);

  const handlePlay = () => {
    if (!blob) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); setPlaying(false); audioRef.current = null; };
    audioRef.current = audio;
    setPlaying(true);
    audio.play();
  };

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      padding: 12, display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <button onClick={handlePlay} style={{
        width: 28, height: 28, borderRadius: '50%', border: 'none',
        backgroundColor: '#1f2937', color: '#fff', fontSize: 10,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{playing ? '\u23F8' : '\u25B6'}</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 1, alignItems: 'center', height: 24 }}>
          {bars.map((level, i) => (
            <div key={i} style={{
              width: 2, height: Math.max(2, level * 22),
              backgroundColor: '#6b7280', borderRadius: 1,
            }} />
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
          {formatTime(duration)}
        </div>
      </div>
    </div>
  );
}

function QualityBadge({ warning }: { warning: QualityWarning | null }) {
  if (!warning) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6,
      }}>
        <span style={{ color: '#16a34a', fontSize: 12 }}>{'\u2713'}</span>
        <span style={{ fontSize: 11, color: '#166534' }}>Good quality — clear audio, low noise</span>
      </div>
    );
  }

  const isBlocking = warning.blocking;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
      background: isBlocking ? '#fef2f2' : '#fffbeb',
      border: `1px solid ${isBlocking ? '#fca5a5' : '#fde68a'}`,
      borderRadius: 6,
    }}>
      <span style={{ color: isBlocking ? '#dc2626' : '#d97706', fontSize: 12 }}>
        {isBlocking ? '\u2717' : '\u26A0'}
      </span>
      <span style={{ fontSize: 11, color: isBlocking ? '#991b1b' : '#92400e' }}>
        {warning.message}
      </span>
    </div>
  );
}
