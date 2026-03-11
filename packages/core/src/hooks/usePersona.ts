import { useState, useEffect, useCallback, useRef } from 'react';
import { PersonaApi, type PersonaData, type VoiceEntry } from '../services/personaApi.js';

export interface UsePersonaResult {
  persona: PersonaData | null;
  isLoaded: boolean;
  refresh: () => Promise<void>;
  updateName: (name: string) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  uploadVoice: (file: File, name: string) => Promise<VoiceEntry>;
  deleteVoice: (id: string) => Promise<void>;
  setActiveVoice: (id: string) => Promise<void>;
  previewVoice: (voiceId: string, text: string) => Promise<ArrayBuffer>;
}

export function usePersona(endpoint: string | undefined): UsePersonaResult {
  const [persona, setPersona] = useState<PersonaData | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const apiRef = useRef<PersonaApi | null>(null);
  const endpointRef = useRef<string | undefined>(undefined);

  if (endpoint && endpoint !== endpointRef.current) {
    apiRef.current = new PersonaApi(endpoint);
    endpointRef.current = endpoint;
  }

  const refresh = useCallback(async () => {
    if (!apiRef.current) return;
    try {
      const data = await apiRef.current.getPersona();
      setPersona(data);
      setIsLoaded(true);
    } catch (err) {
      console.warn('[usePersona] fetch failed, using static config:', err);
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (endpoint) refresh();
  }, [endpoint, refresh]);

  const updateName = useCallback(async (name: string) => {
    if (!apiRef.current) return;
    const updated = await apiRef.current.updatePersona({ copilotName: name });
    setPersona(updated);
  }, []);

  const uploadAvatar = useCallback(async (file: File) => {
    if (!apiRef.current) return;
    await apiRef.current.uploadAvatar(file);
    await refresh();
  }, [refresh]);

  const uploadVoice = useCallback(async (file: File, name: string) => {
    if (!apiRef.current) throw new Error('Persona not configured');
    const entry = await apiRef.current.uploadVoice(file, name);
    await refresh();
    return entry;
  }, [refresh]);

  const deleteVoice = useCallback(async (id: string) => {
    if (!apiRef.current) return;
    await apiRef.current.deleteVoice(id);
    await refresh();
  }, [refresh]);

  const setActiveVoice = useCallback(async (id: string) => {
    if (!apiRef.current) return;
    const updated = await apiRef.current.updatePersona({ activeVoiceId: id });
    setPersona(updated);
  }, []);

  const previewVoice = useCallback(async (voiceId: string, text: string) => {
    if (!apiRef.current) throw new Error('Persona not configured');
    return apiRef.current.previewVoice(voiceId, text);
  }, []);

  return {
    persona, isLoaded, refresh,
    updateName, uploadAvatar, uploadVoice, deleteVoice, setActiveVoice, previewVoice,
  };
}
