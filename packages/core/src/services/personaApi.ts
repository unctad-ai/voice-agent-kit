export interface PersonaData {
  copilotName: string;
  avatarUrl: string;
  activeVoiceId: string;
  voices: VoiceEntry[];
  // Shared settings
  copilotColor: string;
  siteTitle: string;
  greetingMessage: string;
  farewellMessage: string;
  systemPromptIntro: string;
  language: string;
}

export interface VoiceEntry {
  id: string;
  name: string;
  filename: string;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
const API_KEY = import.meta.env.VITE_API_KEY || '';


function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  return headers;
}

export class PersonaApi {
  constructor(private endpoint: string) {}

  private url(path: string): string {
    return `${BACKEND_URL}${this.endpoint}${path}`;
  }

  async getConfig(): Promise<PersonaData | null> {
    const res = await fetch(this.url('/config'), { headers: authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
    return res.json();
  }

  /** @deprecated Use getConfig() */
  async getPersona(): Promise<PersonaData | null> {
    return this.getConfig();
  }

  async updateConfig(
    data: Partial<Omit<PersonaData, 'avatarUrl' | 'voices'>>,
    adminPassword?: string,
  ): Promise<PersonaData> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (adminPassword) headers['X-Admin-Password'] = adminPassword;
    const res = await fetch(this.url('/config'), {
      method: 'PUT',
      headers: authHeaders(headers),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Update config failed: ${res.status}`);
    return res.json();
  }

  /** @deprecated Use updateConfig() */
  async updatePersona(data: { copilotName?: string; activeVoiceId?: string }): Promise<PersonaData> {
    return this.updateConfig(data);
  }

  async uploadAvatar(file: File, adminPassword?: string): Promise<{ avatarUrl: string }> {
    const form = new FormData();
    form.append('image', file);
    const headers = authHeaders();
    if (adminPassword) headers['X-Admin-Password'] = adminPassword;
    const res = await fetch(this.url('/avatar'), { method: 'POST', headers, body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `Avatar upload failed: ${res.status}`);
    }
    return res.json();
  }

  async getVoices(): Promise<VoiceEntry[]> {
    const res = await fetch(this.url('/voices'), { headers: authHeaders() });
    if (!res.ok) throw new Error(`Voices fetch failed: ${res.status}`);
    const data = await res.json();
    return data.voices ?? [];
  }

  async uploadVoice(file: File, name: string, adminPassword?: string): Promise<VoiceEntry> {
    const form = new FormData();
    form.append('audio', file);
    form.append('name', name);
    const headers = authHeaders();
    if (adminPassword) headers['X-Admin-Password'] = adminPassword;
    const res = await fetch(this.url('/voices'), { method: 'POST', headers, body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Upload failed: ${res.status}` }));
      throw new Error(err.error ?? `Upload failed: ${res.status}`);
    }
    return res.json();
  }

  async deleteVoice(id: string, adminPassword?: string): Promise<void> {
    const headers = authHeaders();
    if (adminPassword) headers['X-Admin-Password'] = adminPassword;
    const res = await fetch(this.url(`/voices/${id}`), { method: 'DELETE', headers });
    if (!res.ok) throw new Error(`Voice delete failed: ${res.status}`);
  }

  async previewVoice(voiceId: string, text: string): Promise<ArrayBuffer> {
    const res = await fetch(this.url(`/voices/${voiceId}/preview`), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Voice preview failed: ${res.status}`);
    return res.arrayBuffer();
  }
}
