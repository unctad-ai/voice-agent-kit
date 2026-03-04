import type { ReactNode } from 'react';
import { UIActionRegistryProvider } from './UIActionRegistry';
import { FormFieldRegistryProvider } from './FormFieldRegistry';

// CopilotKit removed — useChat (Vercel AI SDK) is standalone, no provider needed.
// UIActionRegistry and FormFieldRegistry remain as pure React contexts.
export default function CopilotProvider({ children }: { children: ReactNode }) {
  return (
    <UIActionRegistryProvider>
      <FormFieldRegistryProvider>{children}</FormFieldRegistryProvider>
    </UIActionRegistryProvider>
  );
}
