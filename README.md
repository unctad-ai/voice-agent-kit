# Voice Agent Kit

A modular toolkit for adding a voice-powered AI copilot to any web application. Provides a complete voice pipeline — speech-to-text, voice activity detection, LLM reasoning with tool use, and text-to-speech — packaged as drop-in React components and Express handlers.

Built for government service portals (eRegistrations), but adaptable to any domain where users need guided, conversational assistance.

## Packages

| Package | Description |
|---------|-------------|
| [`@unctad-ai/voice-agent-core`](./packages/core) | Hooks, types, and configuration for the voice pipeline (VAD, audio, state management) |
| [`@unctad-ai/voice-agent-ui`](./packages/ui) | Glass-morphism UI components — floating panel, orb, waveform, onboarding, settings |
| [`@unctad-ai/voice-agent-registries`](./packages/registries) | Dynamic registries for form fields, UI actions, and client-side tool handlers |
| [`@unctad-ai/voice-agent-server`](./packages/server) | Express route handlers for chat (Groq LLM), STT, and TTS |

All packages are published to npm under the `@unctad-ai` scope and versioned together.

## Quick Start

### Install

```bash
# Client
npm install @unctad-ai/voice-agent-core @unctad-ai/voice-agent-ui @unctad-ai/voice-agent-registries

# Server
npm install @unctad-ai/voice-agent-core @unctad-ai/voice-agent-server

# Peer dependencies (client)
npm install react react-dom motion lucide-react simplex-noise
```

### Wire Up the Client

```tsx
// voice-config.ts
import type { SiteConfig } from '@unctad-ai/voice-agent-core';

export const siteConfig: SiteConfig = {
  copilotName: 'Pesa',
  siteTitle: "Kenya's Business Gateway",
  farewellMessage: 'Feel free to come back anytime.',
  systemPromptIntro: 'You help investors navigate government services.',

  avatarUrl: '/avatar.png',
  colors: {
    primary: '#DB2129',
    processing: '#F59E0B',
    speaking: '#14B8A6',
    glow: '#f35f3f',
  },

  services: [/* your service catalog */],
  categories: [/* grouped categories */],
  synonyms: { tax: ['pin', 'vat', 'kra'] },
  categoryMap: { investor: 'Investor services' },
  routeMap: { home: '/', dashboard: '/dashboard' },
  getServiceFormRoute: (id) => `/dashboard/${id}`,
};
```

```tsx
// App.tsx
import { lazy, Suspense, useState, useCallback } from 'react';
import { VoiceAgentProvider, VoiceOnboarding, VoiceA11yAnnouncer } from '@unctad-ai/voice-agent-ui';
import type { OrbState } from '@unctad-ai/voice-agent-core';
import { siteConfig } from './voice-config';

const GlassCopilotPanel = lazy(() =>
  import('@unctad-ai/voice-agent-ui').then(m => ({ default: m.GlassCopilotPanel }))
);

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>('idle');

  return (
    <VoiceAgentProvider config={siteConfig}>
      {/* Your app routes here */}

      {!isOpen && <VoiceOnboarding onTryNow={() => setIsOpen(true)} />}
      <Suspense fallback={null}>
        <GlassCopilotPanel
          isOpen={isOpen}
          onOpen={() => setIsOpen(true)}
          onClose={() => setIsOpen(false)}
          onStateChange={setOrbState}
        />
      </Suspense>
      <VoiceA11yAnnouncer isOpen={isOpen} orbState={orbState} />
    </VoiceAgentProvider>
  );
}
```

### Wire Up the Server

```ts
// server/index.ts
import express from 'express';
import { createVoiceRoutes } from '@unctad-ai/voice-agent-server';
import { siteConfig } from '../voice-config';

const app = express();
app.use(express.json());

const voice = createVoiceRoutes(siteConfig);
app.post('/api/chat', voice.chat);
app.post('/api/stt', voice.stt);
app.post('/api/tts', voice.tts);

app.listen(3001);
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser                                            │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ VAD      │→ │ STT       │→ │ GlassCopilotPanel│ │
│  │ (TenVAD) │  │ (Whisper) │  │ (UI + state)     │ │
│  └──────────┘  └───────────┘  └────────┬─────────┘ │
│                                        │            │
│  ┌──────────┐  ┌───────────┐  ┌────────▼─────────┐ │
│  │ Audio    │← │ TTS       │← │ LLM Chat         │ │
│  │ Playback │  │ (stream)  │  │ (Groq + tools)   │ │
│  └──────────┘  └───────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────┘
         ▲                              │
         │         /api/stt             │  /api/chat
         │         /api/tts             ▼
┌─────────────────────────────────────────────────────┐
│  Server (Express)                                   │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐│
│  │ STT Handler│ │ TTS Handler│ │ Chat Handler     ││
│  │ (Whisper)  │ │ (provider) │ │ (Groq + tools)   ││
│  └────────────┘ └────────────┘ └──────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Voice Pipeline

1. **VAD** (Voice Activity Detection) — TenVAD runs in-browser, detects when the user is speaking
2. **STT** (Speech-to-Text) — Audio chunks sent to server, transcribed via Whisper
3. **LLM** — Transcript sent to Groq (Llama), which can call tools (search services, navigate, fill forms)
4. **TTS** (Text-to-Speech) — LLM response streamed back as audio, played with barge-in support

## Registries

Registries let consuming apps dynamically expose their UI to the voice agent.

### Form Fields

```tsx
import { useRegisterFormField } from '@unctad-ai/voice-agent-registries';

function CompanyNameInput() {
  const [value, setValue] = useState('');

  useRegisterFormField({
    id: 'companyName',
    label: 'Company Name',
    type: 'text',
    required: true,
    setter: setValue,
    group: 'company-details',
  });

  return <input value={value} onChange={e => setValue(e.target.value)} />;
}
```

The voice agent can now fill this field via the `fillFormFields` tool.

### UI Actions

```tsx
import { useRegisterUIAction } from '@unctad-ai/voice-agent-registries';

function Dashboard() {
  useRegisterUIAction({
    id: 'openSettings',
    label: 'Open Settings',
    category: 'navigation',
    handler: () => navigate('/settings'),
  });

  return <div>...</div>;
}
```

## UI Components

| Component | Purpose |
|-----------|---------|
| `VoiceAgentProvider` | Context provider — wraps your app with SiteConfig |
| `GlassCopilotPanel` | Main floating panel (392px, glass morphism, collapsed/expanded) |
| `VoiceOnboarding` | First-time user prompt to try the voice agent |
| `VoiceA11yAnnouncer` | Screen reader live region for state changes |
| `AgentAvatar` | Copilot portrait with state-based visual effects |
| `VoiceOrb` | Animated speaking/processing indicator |
| `VoiceWaveformCanvas` | Real-time audio waveform visualization |
| `VoiceControls` | Mic, stop, volume controls |
| `VoiceSettingsView` | User preferences (volume, speed, auto-listen, timeouts) |
| `VoiceToolCard` | Displays tool execution results inline |
| `VoiceTranscript` | Conversation transcript display |
| `VoiceErrorBoundary` | Error boundary with recovery UI |

## Configuration

### SiteConfig

```ts
interface SiteConfig {
  // Identity
  copilotName: string;          // Display name ("Pesa", "Tashi")
  siteTitle: string;            // Site name shown in UI
  farewellMessage: string;      // Said when closing session
  systemPromptIntro: string;    // LLM system prompt prefix

  // Branding
  colors: {
    primary: string;            // Main accent color
    processing: string;         // Shown during STT/thinking
    speaking: string;           // Shown during TTS playback
    glow: string;               // Orb glow effect
    error?: string;             // Error state
  };

  // Domain data
  services: ServiceBase[];      // Searchable service catalog
  categories: CategoryBase[];   // Grouped for browsing
  synonyms: Record<string, string[]>;  // Fuzzy search mappings
  categoryMap: Record<string, string>; // Category aliases
  routeMap: Record<string, string>;    // Named routes
  getServiceFormRoute: (serviceId: string) => string | null;

  // Optional
  avatarUrl?: string;
  extraServerTools?: Record<string, unknown>;
  thresholdOverrides?: Partial<VoiceThresholds>;
}
```

### Voice Thresholds

Fine-tune VAD sensitivity via `thresholdOverrides`:

```ts
{
  positiveSpeechThreshold: 0.8,   // Confidence to start recording
  negativeSpeechThreshold: 0.4,   // Confidence to stop
  minSpeechFrames: 5,             // Min frames before accepting
  redemptionFrames: 15,           // ~600ms grace period
  minAudioRms: 0.005,             // Minimum volume level
}
```

## Development

### Prerequisites

- Node.js 22+
- pnpm 10+

### Setup

```bash
git clone https://github.com/unctad-ai/voice-agent-kit.git
cd voice-agent-kit
pnpm install
```

### Commands

```bash
pnpm dev          # Watch mode (all packages)
pnpm build        # Build all packages
pnpm typecheck    # Type-check all packages
```

### Project Structure

```
voice-agent-kit/
├── packages/
│   ├── core/           # Hooks, types, config, audio utilities
│   ├── ui/             # React components (tsup build)
│   ├── registries/     # Form/UI action registries
│   └── server/         # Express handlers (chat, STT, TTS)
├── scripts/
│   └── validate-release.sh
├── .changeset/         # Version management
├── .github/workflows/
│   ├── ci.yml          # Typecheck + validate on push/PR
│   └── publish.yml     # Publish to npm on v* tags
└── .husky/
    └── pre-commit      # Typecheck gate
```

## Release

```bash
pnpm changeset        # Describe what changed (interactive)
git add . && git commit -m "chore: add changeset"

pnpm release          # Bumps versions + validates (clean build, dist check, dry-run publish)
git add . && git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push --follow-tags && git push origin vX.Y.Z
# CI publishes to npm automatically
```

All four packages use **fixed versioning** — they always share the same version number.

## License

ISC
