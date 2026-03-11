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
  const personaResult = usePersona(config.personaEndpoint);

  // While persona is loading, suppress static avatarUrl to avoid flash
  // (static avatar → persona avatar). Name and other fields are fine.
  const personaLoading = !!config.personaEndpoint && !personaResult.isLoaded;

  const mergedConfig = useMemo<SiteConfig>(() => {
    if (personaResult.persona) {
      return {
        ...config,
        copilotName: personaResult.persona.copilotName ?? config.copilotName,
        avatarUrl: personaResult.persona.avatarUrl ?? config.avatarUrl,
      };
    }
    if (personaLoading) {
      return { ...config, avatarUrl: undefined };
    }
    return config;
  }, [config, personaResult.persona, personaLoading]);

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
