# CLAUDE.md — Voice Agent Kit

## Project Overview

Monorepo with 4 npm packages (`@unctad-ai/voice-agent-*`) providing a complete voice AI copilot for web apps. Fixed versioning — all packages share the same version.

## Commands

```bash
pnpm install              # Install all deps
pnpm dev                  # Watch mode (all packages)
pnpm build                # Build all packages
pnpm typecheck            # Type-check all packages
```

## Release

```bash
pnpm changeset            # Describe changes (interactive — picks affected packages)
git add . && git commit   # Commit the changeset
./scripts/release.sh      # Bumps versions, validates, tags, pushes → CI publishes
./scripts/release.sh --yes  # Skip confirmation (AI-friendly, requires existing changeset)
```

**Rules:**
- Never bump versions manually — changesets manages them
- Never `npm publish` locally — CI handles it via `publish.yml` on `v*` tags
- Always release from `main` branch
- All 4 packages are in a fixed version group (`.changeset/config.json`)

## Package Architecture

| Package | Role | Build |
|---------|------|-------|
| `core` | Hooks (`useVoiceAgent`, `useTenVAD`, `useAudioPlayback`), types, config | `tsc` |
| `registries` | Form fields, UI actions, client tool handlers | `tsc` |
| `ui` | React components (GlassCopilotPanel, VoiceOrb, etc.) | `tsup` |
| `server` | Express route handlers (chat, STT, TTS) | `tsc` |

**Dependency chain:** `server` ← `core` → `registries` → `ui`

## Key Architecture Decisions

### Client vs Server Tools

Tools in `builtinTools.ts` (server package) are split into two groups:

- **Server tools** — have `execute` function, run server-side: `searchServices`, `getServiceDetails`, `listServicesByCategory`, `compareServices`
- **Client tools** — NO `execute`, resolved on client via `onToolCall` + `addToolOutput`: `navigateTo`, `viewService`, `startApplication`, `performUIAction`, `getFormSchema`, `fillFormFields`

Client tools trigger `sendAutomaticallyWhen` to send follow-up requests with tool results.

### Multi-Step Client Tool Flow

When the LLM chains client tools (e.g. `fillFormFields` → `getFormSchema`), each tool call appends to the **same** assistant message. The dedup guard in `sendAutomaticallyWhen` uses `${messageId}:${resolvedToolCount}` as key (not just message ID) to allow successive follow-ups on the same message. The `roundTripCountRef` (max 25) prevents infinite loops.

### TTS/STT Provider Defaults

- Default TTS: `qwen3-tts` (not resemble). URLs default to `localhost` — production overrides via env vars (`QWEN3_TTS_URL`, `KYUTAI_STT_URL`, etc.)
- Never hardcode GPU server IPs in code. Use full URLs in `.env` files.
- Fallback chains: qwen3-tts → pocket-tts → resemble; kyutai → groq whisper

## Consuming Projects

Projects using the kit (Kenyaservices, Bhutanephyto, Licenseportaldemo) need:

**Frontend:** `@unctad-ai/voice-agent-core`, `@unctad-ai/voice-agent-registries`, `@unctad-ai/voice-agent-ui`
**Server:** `@unctad-ai/voice-agent-core`, `@unctad-ai/voice-agent-server`

**Required server `.env`:**
```
GROQ_API_KEY=...
KYUTAI_STT_URL=http://...     # Full URL, no GPU_HOST abstraction
QWEN3_TTS_URL=http://...
CLIENT_API_KEY=...
```

## Development Rules

- `useChat` (from `@ai-sdk/react`) drives the client-server protocol — not CopilotKit
- `streamText` with `pipeUIMessageStreamToResponse` on server, `useChat` on client
- `SiteConfig` is the single configuration object shared between client and server
- Server-side `voice-config.ts` can add `extraServerTools` to SiteConfig for domain-specific tools
- The `registries` package provides `createClientToolHandler` — consuming apps shouldn't reimplement tool handling

## Browser Automation Test IDs

The `ui` package exposes `data-testid` attributes on key elements for reliable browser automation (Chrome DevTools Protocol, Playwright, etc.):

| Test ID | Element | Location |
|---------|---------|----------|
| `voice-agent-fab` | Floating action button (opens panel) | Always visible when panel is closed |
| `voice-agent-bar` | Collapsed bar (click to expand) | Visible when panel is collapsed |
| `voice-agent-panel` | Main dialog container | Visible when panel is expanded |
| `voice-agent-mic` | Microphone / voice orb button | Inside expanded panel |
| `voice-agent-keyboard` | "Type a message" button | Inside expanded panel (voice mode) |
| `voice-agent-input` | Text input field | Inside expanded panel (keyboard mode) |
| `voice-agent-send` | Send message button | Inside expanded panel (keyboard mode) |
| `voice-agent-voice-mode` | "Back to voice" button | Inside expanded panel (keyboard mode) |
| `voice-agent-status` | Status text (e.g. "Listening", "Processing") | Inside expanded panel header |
| `voice-agent-settings` | Settings gear button | Inside expanded panel header |
| `voice-agent-minimize` | Minimize/collapse button | Inside expanded panel header |
| `voice-agent-close` | Close button | Inside expanded panel header |
| `voice-agent-transcript` | Transcript/messages container | Inside expanded panel |

**Usage in browser automation:**
```javascript
// Click to open the panel
document.querySelector('[data-testid="voice-agent-fab"]').click();
// Or with CDP:
// {action: "click", selector: "[data-testid='voice-agent-fab']"}
```
