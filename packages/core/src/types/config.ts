export interface ServiceBase {
  id: string;
  title: string;
  category: string;
  overview?: string;
  duration?: string;
  cost?: string;
  requirements?: string[];
  eligibility?: string[];
  steps?: Array<{ title: string; description: string }>;
  [key: string]: unknown;
}

export interface CategoryBase {
  title: string;
  services: ServiceBase[];
}

export interface VoiceThresholds {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechFrames: number;
  preSpeechPadFrames: number;
  redemptionFrames: number;
  minAudioRms: number;
  maxNoSpeechProb: number;
  minAvgLogprob: number;
}

export interface SiteColors {
  primary: string;
  processing: string;
  speaking: string;
  glow: string;
  error?: string;
}

export interface SiteConfig {
  // Identity
  copilotName: string;
  siteTitle: string;
  /** @deprecated No longer used — session end is manual. Kept for backward compat. */
  farewellMessage?: string;
  systemPromptIntro: string;

  // Branding
  colors: SiteColors;
  /** Font family for the entire voice UI. Defaults to 'DM Sans, sans-serif'. */
  fontFamily?: string;

  // Domain data
  services: ServiceBase[];
  categories: CategoryBase[];
  synonyms: Record<string, string[]>;
  categoryMap: Record<string, string>;

  // Routing
  routeMap: Record<string, string>;
  getServiceFormRoute: (serviceId: string) => string | null;

  // Optional
  avatarUrl?: string;
  extraServerTools?: Record<string, unknown>;
  thresholdOverrides?: Partial<VoiceThresholds>;

  /** Base path for persona API (e.g., '/api/agent'). Enables admin persona settings. */
  personaEndpoint?: string;

  /** BCP-47 language code for STT (e.g. 'en', 'fr', 'sw'). Defaults to 'en'. */
  language?: string;

  /** Initial greeting shown/spoken when the panel opens. */
  greetingMessage?: string;
}
