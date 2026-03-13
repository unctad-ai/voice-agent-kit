import { SiteConfigProvider } from '@unctad-ai/voice-agent-core';
import { CopilotProvider } from '@unctad-ai/voice-agent-registries';
import { VoiceSettingsProvider } from './contexts/VoiceSettingsContext';
import type { SiteConfig } from '@unctad-ai/voice-agent-core';

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
        <VoiceSettingsProvider siteLanguage={config.language}>
          {children}
        </VoiceSettingsProvider>
      </CopilotProvider>
    </SiteConfigProvider>
  );
}
