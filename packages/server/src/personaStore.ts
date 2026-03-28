import fs from 'node:fs';
import path from 'node:path';
import type { SiteConfig } from '@unctad-ai/voice-agent-core';

export interface StoredPersona {
  copilotName: string;
  avatarFilename: string;
  activeVoiceId: string;
  voices: { id: string; name: string; filename: string; cachedAt: string }[];
  // Shared settings (optional — fallback to siteConfig)
  copilotColor?: string;
  siteTitle?: string;
  greetingMessage?: string;
  farewellMessage?: string;
  systemPromptIntro?: string;
  language?: string;
  suggestedPrompts?: string;
}

export interface FullConfig {
  copilotName: string;
  copilotColor: string;
  siteTitle: string;
  greetingMessage: string;
  farewellMessage: string;
  systemPromptIntro: string;
  language: string;
  suggestedPrompts: string;
  avatarFilename: string;
  activeVoiceId: string;
  voices: { id: string; name: string; filename: string; cachedAt: string }[];
}

const DEFAULT_PERSONA: StoredPersona = {
  copilotName: '',
  avatarFilename: '',
  activeVoiceId: '',
  voices: [],
};

export class PersonaStore {
  private data: StoredPersona;
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private personaDir: string, private siteConfig?: SiteConfig) {
    fs.mkdirSync(path.join(personaDir, 'voices'), { recursive: true });
    this.filePath = path.join(personaDir, 'persona.json');
    this.data = this.load();
  }

  private load(): StoredPersona {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return { ...DEFAULT_PERSONA, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_PERSONA };
    }
  }

  private async save(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() =>
      fs.promises.writeFile(this.filePath, JSON.stringify(this.data, null, 2))
    );
    await this.writeQueue;
  }

  get(): StoredPersona {
    return { ...this.data };
  }

  getFullConfig(): FullConfig {
    const sc = this.siteConfig;
    return {
      copilotName: this.data.copilotName ?? sc?.copilotName ?? '',
      copilotColor: this.data.copilotColor ?? sc?.colors?.primary ?? '#1B5E20',
      siteTitle: this.data.siteTitle ?? sc?.siteTitle ?? '',
      greetingMessage: this.data.greetingMessage ?? sc?.greetingMessage ?? '',
      farewellMessage: this.data.farewellMessage ?? sc?.farewellMessage ?? '',
      systemPromptIntro: this.data.systemPromptIntro ?? sc?.systemPromptIntro ?? '',
      language: this.data.language ?? sc?.language ?? 'en',
      suggestedPrompts: this.data.suggestedPrompts ?? sc?.suggestedPrompts?.join('\n') ?? '',
      avatarFilename: this.data.avatarFilename,
      activeVoiceId: this.data.activeVoiceId,
      voices: this.data.voices ?? [],
    };
  }

  async update(
    partial: Partial<Pick<StoredPersona,
      'copilotName' | 'activeVoiceId' |
      'copilotColor' | 'siteTitle' | 'greetingMessage' |
      'farewellMessage' | 'systemPromptIntro' | 'language' | 'suggestedPrompts'
    >>,
  ): Promise<StoredPersona> {
    if (partial.copilotName !== undefined) this.data.copilotName = partial.copilotName;
    if (partial.activeVoiceId !== undefined) this.data.activeVoiceId = partial.activeVoiceId;
    if (partial.copilotColor !== undefined) this.data.copilotColor = partial.copilotColor;
    if (partial.siteTitle !== undefined) this.data.siteTitle = partial.siteTitle;
    if (partial.greetingMessage !== undefined) this.data.greetingMessage = partial.greetingMessage;
    if (partial.farewellMessage !== undefined) this.data.farewellMessage = partial.farewellMessage;
    if (partial.systemPromptIntro !== undefined) this.data.systemPromptIntro = partial.systemPromptIntro;
    if (partial.language !== undefined) this.data.language = partial.language;
    if (partial.suggestedPrompts !== undefined) this.data.suggestedPrompts = partial.suggestedPrompts;
    await this.save();
    return this.get();
  }

  async setAvatar(filename: string): Promise<void> {
    this.data.avatarFilename = filename;
    await this.save();
  }

  async addVoice(entry: { id: string; name: string; filename: string }): Promise<void> {
    this.data.voices.push({ ...entry, cachedAt: new Date().toISOString() });
    if (!this.data.activeVoiceId) this.data.activeVoiceId = entry.id;
    await this.save();
  }

  async removeVoice(id: string): Promise<void> {
    this.data.voices = this.data.voices.filter(v => v.id !== id);
    if (this.data.activeVoiceId === id) {
      this.data.activeVoiceId = this.data.voices[0]?.id ?? '';
    }
    await this.save();
  }

  getVoicesDir(): string {
    return path.join(this.personaDir, 'voices');
  }

  getAvatarPath(): string | null {
    if (!this.data.avatarFilename) return null;
    const p = path.join(this.personaDir, this.data.avatarFilename);
    return fs.existsSync(p) ? p : null;
  }

  /** Returns siteConfig with persona overrides applied (copilotName, systemPromptIntro, etc.) */
  getMergedSiteConfig(): SiteConfig | undefined {
    if (!this.siteConfig) return undefined;
    const p = this.data;
    return {
      ...this.siteConfig,
      ...(p.copilotName && { copilotName: p.copilotName }),
      ...(p.siteTitle != null && { siteTitle: p.siteTitle }),
      ...(p.greetingMessage != null && { greetingMessage: p.greetingMessage }),
      ...(p.farewellMessage != null && { farewellMessage: p.farewellMessage }),
      ...(p.systemPromptIntro != null && { systemPromptIntro: p.systemPromptIntro }),
      ...(p.language != null && { language: p.language }),
      ...(p.copilotColor ? { colors: { ...this.siteConfig.colors, primary: p.copilotColor } } : {}),
    };
  }

  getActiveVoiceId(): string {
    return this.data.activeVoiceId;
  }
}
