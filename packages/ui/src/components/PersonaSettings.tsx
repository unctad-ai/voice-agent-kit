import { useState, useRef, useEffect } from 'react';
import { usePersonaContext, useSiteConfig } from '@unctad-ai/voice-agent-core';

export function PersonaSettings() {
  const config = useSiteConfig();
  if (!config.personaEndpoint) return null;

  return <PersonaSettingsInner />;
}

function PersonaSettingsInner() {
  const config = useSiteConfig();
  const persona = usePersonaContext();
  if (!persona) return null;
  const { persona: data, isLoaded, updateName, uploadAvatar, uploadVoice, deleteVoice, setActiveVoice, previewVoice } = persona;

  if (!isLoaded) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: '#9ca3af', fontFamily: 'inherit' }}>
        Loading persona settings...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: 'inherit' }}>
      <AvatarSection avatarUrl={config.avatarUrl} onUpload={uploadAvatar} />
      <NameSection name={config.copilotName} onSave={updateName} primaryColor={config.colors.primary} />
      <VoiceSection
        voices={data?.voices ?? []}
        activeVoiceId={data?.activeVoiceId ?? ''}
        onUpload={uploadVoice}
        onDelete={deleteVoice}
        onSelect={setActiveVoice}
        onPreview={previewVoice}
        primaryColor={config.colors.primary}
      />
    </div>
  );
}

function AvatarSection({ avatarUrl, onUpload }: {
  avatarUrl?: string;
  onUpload: (file: File) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { await onUpload(file); }
    catch (err) { console.error('Avatar upload failed:', err); }
    finally { setUploading(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        position: 'relative',
        width: 64,
        height: 64,
        borderRadius: 9999,
        overflow: 'hidden',
        backgroundColor: '#f3f4f6',
        flexShrink: 0,
      }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="Agent avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9ca3af',
            fontSize: 20,
          }}>?</div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>Avatar</span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            fontSize: 11,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 4,
            paddingBottom: 4,
            borderRadius: 6,
            border: '1px solid #e5e7eb',
            backgroundColor: hovered && !uploading ? '#f9fafb' : 'transparent',
            cursor: uploading ? 'wait' : 'pointer',
            opacity: uploading ? 0.5 : 1,
            transition: 'background-color 0.15s',
            fontFamily: 'inherit',
          }}
        >
          {uploading ? 'Uploading...' : 'Change'}
        </button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} style={{ display: 'none' }} />
      </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>Agent Name</span>
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
            borderRadius: 6,
            border: `1px solid ${inputFocused ? '#9ca3af' : '#e5e7eb'}`,
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
              fontSize: 11,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: 6,
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

function VoiceSection({ voices, activeVoiceId, onUpload, onDelete, onSelect, onPreview, primaryColor }: {
  voices: { id: string; name: string }[];
  activeVoiceId: string;
  onUpload: (file: File, name: string) => Promise<any>;
  onDelete: (id: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onPreview: (id: string, text: string) => Promise<ArrayBuffer>;
  primaryColor: string;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: '#6b7280' }}>Voice</span>

      {voices.length === 0 && (
        <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
          No voices configured. Upload a WAV sample to enable voice cloning.
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
          onDelete={() => onDelete(v.id)}
          primaryColor={primaryColor}
        />
      ))}

      {showUpload ? (
        <UploadForm
          uploadName={uploadName}
          uploading={uploading}
          onNameChange={setUploadName}
          onUpload={handleUpload}
          onCancel={() => { setShowUpload(false); fileRef.current = null; }}
          primaryColor={primaryColor}
        />
      ) : (
        <UploadButton
          disabled={voices.length >= 10}
          onClick={() => inputRef.current?.click()}
        />
      )}

      <input ref={inputRef} type="file" accept="audio/wav" onChange={handleFileSelect} style={{ display: 'none' }} />
    </div>
  );
}

function VoiceRow({ voice, isActive, isPreviewing, onSelect, onPreview, onDelete, primaryColor }: {
  voice: { id: string; name: string };
  isActive: boolean;
  isPreviewing: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onDelete: () => void;
  primaryColor: string;
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
      borderRadius: 6,
      border: `1px solid ${isActive ? '#9ca3af' : '#e5e7eb'}`,
      backgroundColor: isActive ? '#f9fafb' : 'transparent',
      fontSize: 13,
    }}>
      <input
        type="radio"
        name="active-voice"
        checked={isActive}
        onChange={onSelect}
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

function UploadButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontSize: 11,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 6,
        paddingBottom: 6,
        borderRadius: 6,
        border: '1px dashed #d1d5db',
        backgroundColor: hovered && !disabled ? '#f9fafb' : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.15s',
        fontFamily: 'inherit',
      }}
    >
      + Upload voice sample (WAV, max 30s)
    </button>
  );
}
