import { createContext, useContext } from 'react';
import type { SiteConfig } from '../types/config';

const SiteConfigContext = createContext<SiteConfig | null>(null);

export function SiteConfigProvider({
  config,
  children,
}: {
  config: SiteConfig;
  children: React.ReactNode;
}) {
  return (
    <SiteConfigContext.Provider value={config}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig(): SiteConfig {
  const config = useContext(SiteConfigContext);
  if (!config) {
    throw new Error('useSiteConfig must be used within a SiteConfigProvider');
  }
  return config;
}
