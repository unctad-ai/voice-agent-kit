import { useState, useRef, useEffect } from 'react';
import { usePersonaContext, useSiteConfig } from '@unctad-ai/voice-agent-core';
import { cn } from '../utils.js';

export function PersonaSettings() {
  const config = useSiteConfig();
  if (!config.personaEndpoint) return null;

  return <PersonaSettingsInner />;
}

function PersonaSettingsInner() {
  const config = useSiteConfig();
  const persona = usePersonaContext();
  const { persona: data, isLoaded, updateName, uploadAvatar, uploadVoice, deleteVoice, setActiveVoice, previewVoice } = persona;

  if (!isLoaded) {
    return <div className="p-4 text-sm text-neutral-400">Loading persona settings...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <AvatarSection avatarUrl={config.avatarUrl} onUpload={uploadAvatar} />
      <NameSection name={config.copilotName} onSave={updateName} />
      <VoiceSection
        voices={data?.voices ?? []}
        activeVoiceId={data?.activeVoiceId ?? ''}
        onUpload={uploadVoice}
        onDelete={deleteVoice}
        onSelect={setActiveVoice}
        onPreview={previewVoice}
      />
    </div>
  );
}

function AvatarSection({ avatarUrl, onUpload }: {
  avatarUrl?: string;
  onUpload: (file: File) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
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
    <div className="flex items-center gap-3">
      <div className="relative w-16 h-16 rounded-full overflow-hidden bg-neutral-100 shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Agent avatar" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-400 text-xl">?</div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-neutral-500">Avatar</span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "text-xs px-2.5 py-1 rounded-md border border-neutral-200",
            "hover:bg-neutral-50 transition-colors cursor-pointer",
            uploading && "opacity-50 cursor-wait"
          )}
        >
          {uploading ? 'Uploading...' : 'Change'}
        </button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} className="hidden" />
      </div>
    </div>
  );
}

function NameSection({ name, onSave }: {
  name: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const dirty = value !== name;

  useEffect(() => { setValue(name); }, [name]);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(value); }
    catch (err) { console.error('Name update failed:', err); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">Agent Name</span>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          className="flex-1 text-sm px-2.5 py-1.5 rounded-md border border-neutral-200 outline-none focus:border-neutral-400"
          maxLength={30}
        />
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-2.5 py-1 rounded-md bg-neutral-800 text-white hover:bg-neutral-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}

function VoiceSection({ voices, activeVoiceId, onUpload, onDelete, onSelect, onPreview }: {
  voices: { id: string; name: string }[];
  activeVoiceId: string;
  onUpload: (file: File, name: string) => Promise<any>;
  onDelete: (id: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  onPreview: (id: string, text: string) => Promise<ArrayBuffer>;
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
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-neutral-500">Voice</span>

      {voices.length === 0 && (
        <p className="text-xs text-neutral-400">No voices configured. Upload a WAV sample to enable voice cloning.</p>
      )}

      {voices.map(v => (
        <div key={v.id} className={cn(
          "flex items-center gap-2 px-2.5 py-2 rounded-md border text-sm",
          v.id === activeVoiceId ? "border-neutral-400 bg-neutral-50" : "border-neutral-200"
        )}>
          <input
            type="radio"
            name="active-voice"
            checked={v.id === activeVoiceId}
            onChange={() => onSelect(v.id)}
            className="accent-neutral-800"
          />
          <span className="flex-1">{v.name}</span>
          <button
            onClick={() => handlePreview(v.id)}
            disabled={previewing === v.id}
            className="text-xs text-neutral-500 hover:text-neutral-700 cursor-pointer disabled:opacity-50"
          >
            {previewing === v.id ? 'Playing...' : 'Preview'}
          </button>
          <button
            onClick={() => onDelete(v.id)}
            className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
          >
            Delete
          </button>
        </div>
      ))}

      {showUpload ? (
        <div className="flex flex-col gap-2 p-2.5 rounded-md border border-neutral-200 bg-neutral-50">
          <input
            type="text"
            value={uploadName}
            onChange={e => setUploadName(e.target.value)}
            placeholder="Voice name"
            className="text-sm px-2.5 py-1.5 rounded-md border border-neutral-200 outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadName}
              className="text-xs px-2.5 py-1 rounded-md bg-neutral-800 text-white hover:bg-neutral-700 cursor-pointer disabled:opacity-50"
            >
              {uploading ? 'Processing (~8s)...' : 'Upload'}
            </button>
            <button
              onClick={() => { setShowUpload(false); fileRef.current = null; }}
              className="text-xs px-2.5 py-1 rounded-md border border-neutral-200 hover:bg-neutral-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={voices.length >= 10}
          className={cn(
            "text-xs px-2.5 py-1.5 rounded-md border border-dashed border-neutral-300",
            "hover:bg-neutral-50 transition-colors cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          + Upload voice sample (WAV, max 30s)
        </button>
      )}

      <input ref={inputRef} type="file" accept="audio/wav" onChange={handleFileSelect} className="hidden" />
    </div>
  );
}
