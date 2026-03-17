import { useState, useEffect, useCallback, useRef } from 'react';
import { PersonaApi, type PersonaData, type VoiceEntry } from '../services/personaApi.js';

export interface UsePersonaResult {
  persona: PersonaData | null;
  isLoaded: boolean;
  refresh: () => Promise<void>;
  updateName: (name: string, adminPassword?: string) => Promise<void>;
  uploadAvatar: (file: File, adminPassword?: string) => Promise<void>;
  uploadVoice: (file: File, name: string, adminPassword?: string) => Promise<VoiceEntry>;
  deleteVoice: (id: string, adminPassword?: string) => Promise<void>;
  setActiveVoice: (id: string, adminPassword?: string) => Promise<void>;
  previewVoice: (voiceId: string, text: string) => Promise<ArrayBuffer>;
  updateConfig: (fields: Partial<Omit<PersonaData, 'avatarUrl' | 'voices'>>, adminPassword?: string) => Promise<void>;
}

// Module-level cache — survives re-mounts, shared across instances.
const personaCache = new Map<string, PersonaData>();

export function usePersona(
  endpoint: string | undefined,
  wsMessages?: { onMessage: (handler: (data: any) => void) => () => void },
): UsePersonaResult {
  const cacheKey = endpoint ?? '';
  const cached = cacheKey ? personaCache.get(cacheKey) : undefined;

  const [persona, setPersona] = useState<PersonaData | null>(cached ?? null);
  const [isLoaded, setIsLoaded] = useState(!!cached);
  const apiRef = useRef<PersonaApi | null>(null);
  const endpointRef = useRef<string | undefined>(undefined);

  if (endpoint && endpoint !== endpointRef.current) {
    apiRef.current = new PersonaApi(endpoint);
    endpointRef.current = endpoint;
  }

  const refresh = useCallback(async () => {
    if (!apiRef.current || !cacheKey) return;
    try {
      const data = await apiRef.current.getConfig();
      if (data) {
        personaCache.set(cacheKey, data);
        setPersona(data);
      }
      setIsLoaded(true);
    } catch (err) {
      console.warn('[usePersona] fetch failed, using static config:', err);
      personaCache.delete(cacheKey);
      setPersona(null);
      setIsLoaded(true);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (endpoint) refresh();
  }, [endpoint, refresh]);

  // Listen for config.updated WebSocket events
  useEffect(() => {
    if (!wsMessages) return;
    const unsub = wsMessages.onMessage((data) => {
      if (data.type === 'config.updated' && data.config) {
        const cached = personaCache.get(cacheKey);
        const updated = { ...cached, ...data.config } as PersonaData;
        personaCache.set(cacheKey, updated);
        setPersona(updated);
      }
    });
    return unsub;
  }, [wsMessages, cacheKey]);

  const updateName = useCallback(async (name: string, adminPassword?: string) => {
    if (!apiRef.current) return;
    const updated = await apiRef.current.updateConfig({ copilotName: name }, adminPassword);
    personaCache.set(cacheKey, updated);
    setPersona(updated);
  }, [cacheKey]);

  const uploadAvatar = useCallback(async (file: File, adminPassword?: string) => {
    if (!apiRef.current) return;
    await apiRef.current.uploadAvatar(file, adminPassword);
    await refresh();
  }, [refresh]);

  const uploadVoice = useCallback(async (file: File, name: string, adminPassword?: string) => {
    if (!apiRef.current) throw new Error('Persona not configured');
    const entry = await apiRef.current.uploadVoice(file, name, adminPassword);
    await refresh();
    return entry;
  }, [refresh]);

  const deleteVoice = useCallback(async (id: string, adminPassword?: string) => {
    if (!apiRef.current) return;
    await apiRef.current.deleteVoice(id, adminPassword);
    await refresh();
  }, [refresh]);

  const setActiveVoice = useCallback(async (id: string, adminPassword?: string) => {
    if (!apiRef.current) return;
    const updated = await apiRef.current.updateConfig({ activeVoiceId: id }, adminPassword);
    personaCache.set(cacheKey, updated);
    setPersona(updated);
  }, [cacheKey]);

  const previewVoice = useCallback(async (voiceId: string, text: string) => {
    if (!apiRef.current) throw new Error('Persona not configured');
    return apiRef.current.previewVoice(voiceId, text);
  }, []);

  const updateConfig = useCallback(async (
    fields: Partial<Omit<PersonaData, 'avatarUrl' | 'voices'>>,
    adminPassword?: string,
  ) => {
    if (!apiRef.current) return;
    const updated = await apiRef.current.updateConfig(fields, adminPassword);
    personaCache.set(cacheKey, updated);
    setPersona(updated);
  }, [cacheKey]);

  return {
    persona, isLoaded, refresh,
    updateName, uploadAvatar, uploadVoice, deleteVoice, setActiveVoice, previewVoice,
    updateConfig,
  };
}
