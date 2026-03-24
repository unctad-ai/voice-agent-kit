# @unctad-ai/voice-agent

Meta-package that installs all client-side voice-agent-kit packages in one dependency.

## Install

```bash
npm install @unctad-ai/voice-agent
```

This replaces installing the three packages individually:

```diff
- "@unctad-ai/voice-agent-core": "latest",
- "@unctad-ai/voice-agent-ui": "latest",
- "@unctad-ai/voice-agent-registries": "latest",
+ "@unctad-ai/voice-agent": "latest"
```

## What's included

| Package | Description |
|---------|-------------|
| `@unctad-ai/voice-agent-core` | Hooks, types, WebSocket client, VAD |
| `@unctad-ai/voice-agent-ui` | VoiceAgentProvider, GlassCopilotPanel, VoiceOrb |
| `@unctad-ai/voice-agent-registries` | Form fields, UI actions, client tool handlers |

## Imports

Imports stay the same — use the individual package names:

```ts
import { VoiceAgentProvider, GlassCopilotPanel } from '@unctad-ai/voice-agent-ui';
import { useProgressiveFields } from '@unctad-ai/voice-agent-registries';
```

## Server

`@unctad-ai/voice-agent-server` is **not** included — install it separately in your server's `package.json`.
