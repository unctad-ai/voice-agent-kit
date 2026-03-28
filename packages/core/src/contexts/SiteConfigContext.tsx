import { createContext, useContext, useMemo } from 'react';
import type { SiteConfig } from '../types/config';
import { usePersona, type UsePersonaResult } from '../hooks/usePersona.js';

const SiteConfigContext = createContext<SiteConfig | null>(null);
const PersonaContext = createContext<UsePersonaResult | null>(null);

export function SiteConfigProvider({
  config,
  children,
}: {
  config: SiteConfig;
  children: React.ReactNode;
}) {
  const personaEndpoint = config.personaEndpoint ?? '/api/agent';
  const personaResult = usePersona(personaEndpoint);

  // While persona is loading, suppress static avatarUrl to avoid flash
  // (static avatar → persona avatar). Name and other fields are fine.
  const personaLoading = !personaResult.isLoaded;

  const mergedConfig = useMemo<SiteConfig>(() => {
    const base = { ...config, personaEndpoint };
    const replaceVars = (s: string | undefined, name: string, title: string) =>
      s?.replace(/\{name\}/g, name).replace(/\{siteTitle\}/g, title);
    if (personaResult.persona) {
      const p = personaResult.persona;
      const name = p.copilotName ?? config.copilotName;
      const title = p.siteTitle ?? config.siteTitle;
      return {
        ...base,
        copilotName: name,
        avatarUrl: p.avatarUrl ?? config.avatarUrl,
        siteTitle: title,
        greetingMessage: replaceVars(p.greetingMessage ?? config.greetingMessage, name, title),
        farewellMessage: replaceVars(p.farewellMessage ?? config.farewellMessage, name, title),
        systemPromptIntro: p.systemPromptIntro ?? config.systemPromptIntro,
        language: p.language ?? config.language,
        suggestedPrompts: p.suggestedPrompts
          ? p.suggestedPrompts.split('\n').filter((s: string) => s.trim())
          : config.suggestedPrompts,
        colors: p.copilotColor
          ? { ...config.colors, primary: p.copilotColor }
          : config.colors,
      };
    }
    if (personaLoading) {
      return { ...base, avatarUrl: undefined };
    }
    return base;
  }, [config, personaEndpoint, personaResult.persona, personaLoading]);

  return (
    <PersonaContext.Provider value={personaResult}>
      <SiteConfigContext.Provider value={mergedConfig}>
        {children}
      </SiteConfigContext.Provider>
    </PersonaContext.Provider>
  );
}

export function useSiteConfig(): SiteConfig {
  const config = useContext(SiteConfigContext);
  if (!config) {
    throw new Error('useSiteConfig must be used within a SiteConfigProvider');
  }
  return config;
}

export function usePersonaContext(): UsePersonaResult | null {
  return useContext(PersonaContext);
}
