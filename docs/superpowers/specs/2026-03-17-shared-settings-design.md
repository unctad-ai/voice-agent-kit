# Shared Voice Agent Settings

**Date:** 2026-03-17
**Status:** Approved
**Scope:** `voice-agent-kit` — packages/server, packages/core, packages/ui

## Problem

Voice agent settings are split between two persistence layers with no shared runtime configuration:
- **Per-user preferences** (volume, speed, thresholds) — localStorage, works fine
- **Project-level config** (copilot name, color, greeting, system prompt) — baked into `siteConfig` at build time, requires a full rebuild to change

Non-developer admins cannot adjust copilot behavior (greeting, farewell, system prompt, language) without editing code and triggering a rebuild. These settings should be editable at runtime through the existing VoiceSettingsView panel.

## Solution

Extend `PersonaStore` (which already manages copilot name, avatar, and voice samples in `persona.json`) with shared settings fields. Expose via a renamed API endpoint with admin password protection. Broadcast changes to active WebSocket clients for instant propagation.

### Two-layer config model

1. **`siteConfig`** (build-time) — scaffolded from `.voice-agent.yml` by voice-agent-action, contains services, routes, categories. Immutable at runtime.
2. **`persona.json`** (runtime) — override layer for admin-editable fields. If a field is unset, `siteConfig` provides the fallback.

### Settings scope

| Setting | Scope | Persistence | Why |
|---------|-------|-------------|-----|
| volume, speed, thresholds, TTS on/off | Per-user | localStorage | Personal preference |
| copilotName, copilotColor, avatar | Shared | persona.json | Project identity |
| greetingMessage, farewellMessage | Shared | persona.json | Copilot behavior |
| systemPromptIntro | Shared | persona.json | LLM personality |
| language | Shared (default) | persona.json | STT locale — per-user override in localStorage takes precedence |
| siteTitle | Shared | persona.json | Portal branding |

### Not managed by this UI (build-time only)

| Setting | Why |
|---------|-----|
| `exclude_routes` | Consumed by Claude Code during GitHub Action build only — no runtime effect |
| `voice_agent_version` | npm package version — requires `npm install` + rebuild |
| services, categories, routeMap | Extracted from codebase by Claude Code — not admin-editable |

## Changes

### 1. Extend PersonaStore (`packages/server/src/personaStore.ts`)

Add fields to `StoredPersona` interface:

```typescript
interface StoredPersona {
  // Existing (required in current code)
  copilotName: string;
  avatarFilename: string;
  activeVoiceId: string;
  voices: VoiceEntry[];

  // New shared settings (all optional — fallback to siteConfig)
  copilotColor?: string;
  siteTitle?: string;
  greetingMessage?: string;
  farewellMessage?: string;
  systemPromptIntro?: string;
  language?: string;
}
```

All new fields are optional. When unset, `PersonaStore.get()` falls back to the corresponding `siteConfig` value.

**Constructor change:** `PersonaStore` currently takes only `personaDir: string`. Add `siteConfig: SiteConfig` as a second parameter so the fallback layer is available:

```typescript
constructor(personaDir: string, siteConfig: SiteConfig) {
  this.personaDir = personaDir;
  this.siteConfig = siteConfig;
  // ... existing load logic
}
```

**Merged getter:**

```typescript
get(): FullConfig {
  return {
    copilotName: this.data.copilotName ?? this.siteConfig.copilotName,
    copilotColor: this.data.copilotColor ?? this.siteConfig.colors.primary,
    siteTitle: this.data.siteTitle ?? this.siteConfig.siteTitle,
    greetingMessage: this.data.greetingMessage ?? this.siteConfig.greetingMessage,
    farewellMessage: this.data.farewellMessage ?? this.siteConfig.farewellMessage,
    systemPromptIntro: this.data.systemPromptIntro ?? this.siteConfig.systemPromptIntro,
    language: this.data.language ?? this.siteConfig.language ?? 'en',
    // Existing fields
    avatarFilename: this.data.avatarFilename,
    activeVoiceId: this.data.activeVoiceId,
    voices: this.data.voices ?? [],
  };
}
```

No migration needed — existing `persona.json` files simply lack the new keys, which resolve to `siteConfig` defaults.

### 2. Rename & extend persona routes (`packages/server/src/createPersonaRoutes.ts`)

Rename endpoint from `/persona` to `/config`.

**`GET /config`** (public — no auth):
Returns full merged config (persona.json overrides + siteConfig fallbacks). Response shape:

```json
{
  "copilotName": "Pesa",
  "copilotColor": "#DB2129",
  "siteTitle": "Kenya Trade Single Window",
  "greetingMessage": "Hi, I'm Pesa...",
  "farewellMessage": "Kwaheri!...",
  "systemPromptIntro": "You are Pesa...",
  "language": "en",
  "avatarUrl": "data:image/png;base64,iVBOR...",
  "activeVoiceId": "...",
  "voices": [...]
}
```

**`PUT /config`** (conditionally protected):
Accepts any subset of fields. Admin password required when the request body includes shared settings fields (`copilotColor`, `siteTitle`, `greetingMessage`, `farewellMessage`, `systemPromptIntro`, `language`). Changing `copilotName`, `activeVoiceId` — also require admin password since they affect all users.

Password check:
- Request header: `X-Admin-Password: <password>`
- Server compares against `ADMIN_PASSWORD` env var (default: `admin`) using `crypto.timingSafeEqual`
- On mismatch: `401 { error: "Invalid admin password" }`

**All mutation routes require admin auth:** `PUT /config`, `POST /voices`, `DELETE /voices/:id`, `POST /avatar`. These all affect shared state visible to all users.

**Security note:** This is a simple gate for internal/demo deployments on private domains — not hardened auth. The default password is `admin`. For production-facing deployments, use an auth proxy (Coolify basic auth, Cloudflare Access) to gate the application.

On successful write, broadcast `config.updated` to all connected WebSocket clients (see section 3).

### 3. WebSocket broadcast (`packages/server/src/createVoiceWebSocketHandler.ts`)

The voice WebSocket handler maintains a `Set<WebSocket>` of active connections. Expose a `broadcast(event)` function to the persona routes.

When `PUT /config` succeeds:

```json
{
  "type": "config.updated",
  "config": { /* full merged config */ }
}
```

Sent to all connected clients. Dead connections cleaned up on `close`/`error`.

**Wiring:** `createVoiceWebSocketHandler` returns a `{ handleUpgrade, broadcast }` object instead of just a handler. The `broadcast(event)` function iterates the internal `Set<WebSocket>`, sends the JSON event, and removes dead connections. `attachVoicePipeline` passes `broadcast` to `createPersonaRoutes` so the HTTP route can push to WebSocket clients without owning the connection set.

### 4. Client: extend persona types and hook

**`packages/core/src/services/personaApi.ts`:**
- Rename endpoint path from `/persona` to `/config`
- Extend `PersonaData` interface with new fields
- `updateConfig(fields, adminPassword?)` method — sets `X-Admin-Password` header when provided

**`packages/core/src/hooks/usePersona.ts`:**
- Fetch full config on mount via `GET /api/agent/config`
- Listen for `config.updated` messages on the voice WebSocket
- When received, update local state — triggers React re-render without page reload
- Expose `updateConfig(fields, adminPassword)` function

**Two-layer update propagation:**
1. **Page load:** HTTP fetch `GET /api/agent/config` (covers all clients, always works)
2. **Live session:** WebSocket `config.updated` push (instant, only for clients with active voice panel)

### 5. UI: admin settings section (`packages/ui/src/components/VoiceSettingsView.tsx`)

Add a **"Copilot"** collapsible section to VoiceSettingsView with the shared settings fields:

| Field | Control type |
|-------|-------------|
| copilotName | text input |
| copilotColor | color picker (hex input) |
| siteTitle | text input |
| greetingMessage | textarea |
| farewellMessage | textarea |
| systemPromptIntro | textarea |
| language | select dropdown |

**Admin gate:**
- All shared fields are **read-only by default**
- An "Edit" button prompts for the admin password (modal or inline input)
- On correct password, stored in `sessionStorage` for the session duration
- Fields become editable; changes save on blur or explicit "Save" button
- Incorrect password shows error, fields stay read-only

**Existing Persona section:** Avatar upload and voice management remain in the Persona section, also behind the admin gate since they affect all users.

**Existing per-user settings:** Volume, speed, thresholds, TTS toggle — unchanged, no admin gate, localStorage persistence.

### 6. Server entry point (`packages/server/src/index.ts`)

Add `adminPassword` to `attachVoicePipeline` options:

```typescript
interface VoiceServerOptions {
  // Existing
  config: SiteConfig;
  personaDir?: string;
  groqApiKey: string;
  // ...

  // New
  adminPassword?: string;
}
```

The consuming project's `server/index.ts` (scaffolded by voice-agent-action) passes `process.env.ADMIN_PASSWORD`. The scaffold template adds `ADMIN_PASSWORD` to `.env.example`.

## Data flow

```
Admin saves settings in UI
  → PUT /api/agent/config (X-Admin-Password header)
  → Server validates password
  → PersonaStore.update() writes persona.json
  → Server responds 200 with merged config
  → Server broadcasts config.updated to all WS clients
  → Connected clients update React state instantly
  → Next page load: any client fetches fresh config via GET
```

## File map

| Package | File | Change |
|---------|------|--------|
| `server` | `personaStore.ts` | Extend `StoredPersona`, add fallback to `siteConfig` in `get()` |
| `server` | `createPersonaRoutes.ts` | Rename to `/config`, expand PUT fields, add admin auth, broadcast |
| `server` | `createVoiceWebSocketHandler.ts` | Expose `broadcast` callback, maintain connection set |
| `server` | `index.ts` (attachVoicePipeline) | Accept `adminPassword` option, wire broadcast |
| `core` | `services/personaApi.ts` | Rename endpoint, extend types, add password header |
| `core` | `hooks/usePersona.ts` | WebSocket listener for `config.updated`, expose `updateConfig` |
| `core` | `types/config.ts` | No change — SiteConfig stays build-time |
| `ui` | `VoiceSettingsView.tsx` | Add Copilot section with admin gate |
| `action` | `templates/server/.env.example` | Add `ADMIN_PASSWORD=` |

## Out of Scope

- **Syncing runtime settings back to `.voice-agent.yml`** — could be a future "export" feature
- **Build-time settings UI** (`exclude_routes`, `voice_agent_version`) — these require rebuilds, not runtime changes
- **Multi-user auth / role-based access** — single shared password is sufficient for the current use case
- **Settings history / audit log** — persona.json is a single JSON file, no versioning
