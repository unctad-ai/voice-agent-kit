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
./scripts/release.sh --yes  # Skip confirmation (AI-friendly, blocks major bumps)
./scripts/release.sh --yes --major  # Allow major bump with --yes (explicit intent)
```

**Rules:**
- Never bump versions manually — changesets manages them
- Never `npm publish` locally — CI handles it via `publish.yml` on `v*` tags
- Always release from `main` branch
- All 4 packages are in a fixed version group (`.changeset/config.json`)
- **After changing any `package.json`**, always run `pnpm install` to update `pnpm-lock.yaml` and commit the lockfile. CI uses `--frozen-lockfile` and will fail if the lockfile is stale.
- **After releasing**, redeploy consuming projects: `cd ../singlewindow-deployments && ./scripts/update-all.sh` (requires `COOLIFY_TOKEN` in `.env`). The voice-agent-action only runs on Figma Make pushes — kit-only releases don't auto-deploy.

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

Projects using the kit (Swkenya, Swbhutan, Swsouthafrica, Swlesotho) need:

**Frontend:** `@unctad-ai/voice-agent-core`, `@unctad-ai/voice-agent-registries`, `@unctad-ai/voice-agent-ui`
**Server:** `@unctad-ai/voice-agent-core`, `@unctad-ai/voice-agent-server`

**Required server `.env`:**
```
GROQ_API_KEY=...
KYUTAI_STT_URL=http://...     # Full URL, no GPU_HOST abstraction
QWEN3_TTS_URL=http://...
CLIENT_API_KEY=...
```

## Deployment Pipeline

Each consuming project deploys via a dedicated `voice-agent` branch that is never merged — Figma Make owns `main`.

- **`unctad-ai/voice-agent-action`** — GitHub Action triggered on every push to `main` in a consuming project repo. It rebuilds the `voice-agent` branch with the kit integrated.
- **`.voice-agent.yml`** — config file in each project repo root. Declares `copilot_name`, `domain`, and other per-project settings consumed by the action.
- **Coolify** auto-deploys from the `voice-agent` branch. No manual deploy step.
- **`singlewindow-deployments`** repo manages Coolify provisioning (use `/provision-coolify` skill to set up new projects).
- All projects use `latest` kit version, resolved dynamically at build time — no pinned versions in consuming repos.
- No PRs to `voice-agent` branch — it is force-pushed by the action on each run.

## Form Field Integration

Use `/integrate-form-fields` to add or fix voice-agent form hooks in consuming projects. It applies `useProgressiveFields`, `useRegisterUIAction`, tab/submit patterns using the golden reference at `docs/superpowers/specs/golden-reference/after.tsx`. Full procedure at `docs/superpowers/prompts/audit-form-integration.md`.

## Dependency Hygiene

When a kit package imports a module at runtime, that module **must** be in `dependencies` or `peerDependencies` — never only in `devDependencies`. Consuming projects install the kit via npm; they only get transitive `dependencies`, not `devDependencies`.

- **Before adding an import:** check if the package is already declared correctly
- **Before releasing:** audit any new imports against package.json — `devDependencies`-only runtime imports are silent bugs that break consuming projects
- **Prefer `dependencies`** for packages the kit fully controls (e.g. `groq-sdk`, `sharp`, `multer`). Use `peerDependencies` only when the consumer needs to control the version (e.g. `react`, `express`, `ai`)
- **The scaffold (`voice-agent-action`) should not compensate** for missing kit deps — if the scaffold needs to hardcode a dep, that's a signal the kit's package.json is wrong

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
