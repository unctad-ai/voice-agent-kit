export interface PersonaData {
  copilotName: string;
  avatarUrl: string;
  activeVoiceId: string;
  voices: VoiceEntry[];
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

  async getPersona(): Promise<PersonaData> {
    const res = await fetch(this.url('/persona'), { headers: authHeaders() });
    if (!res.ok) throw new Error(`Persona fetch failed: ${res.status}`);
    return res.json();
  }

  async updatePersona(data: { copilotName?: string; activeVoiceId?: string }): Promise<PersonaData> {
    const res = await fetch(this.url('/persona'), {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Persona update failed: ${res.status}`);
    return res.json();
  }

  async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(this.url('/avatar'), { method: 'POST', headers: authHeaders(), body: form });
    if (!res.ok) throw new Error(`Avatar upload failed: ${res.status}`);
    return res.json();
  }

  async getVoices(): Promise<VoiceEntry[]> {
    const res = await fetch(this.url('/voices'), { headers: authHeaders() });
    if (!res.ok) throw new Error(`Voices fetch failed: ${res.status}`);
    const data = await res.json();
    return data.voices ?? [];
  }

  async uploadVoice(file: File, name: string): Promise<VoiceEntry> {
    const form = new FormData();
    form.append('audio', file);
    form.append('name', name);
    const res = await fetch(this.url('/voices'), { method: 'POST', headers: authHeaders(), body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Upload failed: ${res.status}` }));
      throw new Error(err.error ?? `Upload failed: ${res.status}`);
    }
    return res.json();
  }

  async deleteVoice(id: string): Promise<void> {
    const res = await fetch(this.url(`/voices/${id}`), { method: 'DELETE', headers: authHeaders() });
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
