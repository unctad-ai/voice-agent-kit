import { SiteConfigProvider } from '@voice-agent/core';
import { CopilotProvider } from '@voice-agent/registries';
import { VoiceSettingsProvider } from './contexts/VoiceSettingsContext';
import type { SiteConfig } from '@voice-agent/core';

export function VoiceAgentProvider({
  config,
  children,
}: {
  config: SiteConfig;
  children: React.ReactNode;
}) {
  return (
    <SiteConfigProvider config={config}>
      <CopilotProvider>
        <VoiceSettingsProvider>
          {children}
        </VoiceSettingsProvider>
      </CopilotProvider>
    </SiteConfigProvider>
  );
}
