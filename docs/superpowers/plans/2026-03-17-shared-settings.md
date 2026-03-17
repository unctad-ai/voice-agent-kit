# Shared Voice Agent Settings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable admins to edit shared voice agent settings (copilot color, greeting, farewell, system prompt, language, site title) at runtime through the existing settings panel, with changes persisted server-side and broadcast to connected clients.

**Architecture:** Extend `PersonaStore` with new fields backed by `siteConfig` fallbacks. Rename persona API endpoint to `/config`. Add admin password gate on mutations. Broadcast changes via WebSocket to active voice sessions.

**Tech Stack:** TypeScript, Express, WebSocket (`ws`), React, Framer Motion

**Spec:** `docs/superpowers/specs/2026-03-17-shared-settings-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/types.ts` | Modify | Add `adminPassword` to `VoiceServerOptions` |
| `packages/server/src/personaStore.ts` | Modify | Add shared settings fields, `siteConfig` constructor param, merged `get()` |
| `packages/server/src/createPersonaRoutes.ts` | Modify | Rename endpoint, admin auth middleware, broadcast on write |
| `packages/server/src/createVoiceWebSocketHandler.ts` | Modify | Return `broadcast` function, track connection set |
| `packages/server/src/index.ts` | Modify | Wire broadcast, pass siteConfig + adminPassword |
| `packages/core/src/services/personaApi.ts` | Modify | Rename endpoint, extend types, admin password header |
| `packages/core/src/hooks/usePersona.ts` | Modify | WebSocket listener for `config.updated` |
| `packages/ui/src/components/VoiceSettingsView.tsx` | Modify | Add Copilot settings section |
| `packages/ui/src/components/PersonaSettings.tsx` | Modify | Admin gate for existing persona mutations |

---

## Chunk 1: Server — Types & PersonaStore

### Task 1: Add `adminPassword` to VoiceServerOptions

**Files:**
- Modify: `packages/server/src/types.ts`

- [ ] **Step 1: Add field to interface**

In `VoiceServerOptions`, add after `ttsFallback`:

```typescript
  adminPassword?: string;  // Default: 'admin'. Gates shared settings mutations.
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/types.ts
git commit -m "feat: add adminPassword to VoiceServerOptions"
```

### Task 2: Extend PersonaStore with shared settings

**Files:**
- Modify: `packages/server/src/personaStore.ts`

- [ ] **Step 1: Extend StoredPersona interface**

Add new optional fields to the `StoredPersona` interface:

```typescript
interface StoredPersona {
  copilotName: string;
  avatarFilename: string;
  activeVoiceId: string;
  voices: { id: string; name: string; filename: string; cachedAt: string }[];
  // Shared settings (optional — fallback to siteConfig)
  copilotColor?: string;
  siteTitle?: string;
  greetingMessage?: string;
  farewellMessage?: string;
  systemPromptIntro?: string;
  language?: string;
}
```

- [ ] **Step 2: Add siteConfig as constructor parameter**

Change `PersonaStore` constructor from:

```typescript
constructor(private personaDir: string) {
```

To:

```typescript
constructor(private personaDir: string, private siteConfig: SiteConfig) {
```

Add import for `SiteConfig` from `@unctad-ai/voice-agent-core` at the top.

The `siteConfig` parameter is required — `attachVoicePipeline` always has `options.config` available to pass.

- [ ] **Step 3: Add FullConfig type and merged get method**

Add a new exported type above the class:

```typescript
export interface FullConfig {
  copilotName: string;
  copilotColor: string;
  siteTitle: string;
  greetingMessage: string;
  farewellMessage: string;
  systemPromptIntro: string;
  language: string;
  avatarFilename: string;
  activeVoiceId: string;
  voices: { id: string; name: string; filename: string; cachedAt: string }[];
}
```

Add a new method to `PersonaStore`:

```typescript
getFullConfig(): FullConfig {
  const sc = this.siteConfig;
  return {
    copilotName: this.data.copilotName ?? sc.copilotName,
    copilotColor: this.data.copilotColor ?? sc.colors?.primary ?? '#1B5E20',
    siteTitle: this.data.siteTitle ?? sc.siteTitle ?? '',
    greetingMessage: this.data.greetingMessage ?? sc.greetingMessage ?? '',
    farewellMessage: this.data.farewellMessage ?? sc.farewellMessage ?? '',
    systemPromptIntro: this.data.systemPromptIntro ?? sc.systemPromptIntro ?? '',
    language: this.data.language ?? sc.language ?? 'en',
    avatarFilename: this.data.avatarFilename,
    activeVoiceId: this.data.activeVoiceId,
    voices: this.data.voices ?? [],
  };
}
```

Uses `??` (nullish coalescing) not `||` — this allows admins to set a field to empty string to clear it.

Keep the existing `get data` accessor unchanged — it returns raw `StoredPersona` for internal use.

- [ ] **Step 4: Extend update() to accept new fields**

The current `update()` method accepts `Partial<Pick<StoredPersona, 'copilotName' | 'activeVoiceId'>>`. Expand the Pick to include new fields:

```typescript
async update(
  partial: Partial<Pick<StoredPersona,
    'copilotName' | 'activeVoiceId' |
    'copilotColor' | 'siteTitle' | 'greetingMessage' |
    'farewellMessage' | 'systemPromptIntro' | 'language'
  >>,
): Promise<StoredPersona> {
```

Keep the existing return type `Promise<StoredPersona>` — callers in `createPersonaRoutes` use the return value. Extend the method body to apply new fields with the same pattern as existing ones:

```typescript
if (partial.copilotColor !== undefined) this.data.copilotColor = partial.copilotColor;
if (partial.siteTitle !== undefined) this.data.siteTitle = partial.siteTitle;
if (partial.greetingMessage !== undefined) this.data.greetingMessage = partial.greetingMessage;
if (partial.farewellMessage !== undefined) this.data.farewellMessage = partial.farewellMessage;
if (partial.systemPromptIntro !== undefined) this.data.systemPromptIntro = partial.systemPromptIntro;
if (partial.language !== undefined) this.data.language = partial.language;
```

- [ ] **Step 5: Verify build**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/personaStore.ts
git commit -m "feat: extend PersonaStore with shared settings and siteConfig fallback"
```

---

## Chunk 2: Server — Routes & Broadcast

### Task 3: Add admin auth and rename routes

**Files:**
- Modify: `packages/server/src/createPersonaRoutes.ts`

- [ ] **Step 1: Extend PersonaRoutesOptions and add auth helper**

Add `adminPassword` and `broadcast` to the existing `PersonaRoutesOptions` interface:

```typescript
export interface PersonaRoutesOptions {
  personaDir: string;
  ttsUpstreamUrl?: string;
  store?: PersonaStore;
  // New
  adminPassword?: string;
  broadcast?: (event: Record<string, unknown>) => void;
}
```

The function signature stays `createPersonaRoutes(options: PersonaRoutesOptions)` — unchanged.

Add auth helper at the top of the function body:

```typescript
const password = options.adminPassword ?? 'admin';

function requireAdmin(req: Request, res: Response): boolean {
  const provided = req.headers['x-admin-password'] as string | undefined;
  if (!provided) {
    res.status(401).json({ error: 'Admin password required' });
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(password);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid admin password' });
    return false;
  }
  return true;
}
```

Add `import crypto from 'node:crypto';` at the top of the file.

- [ ] **Step 2: Rename endpoints from /persona to /config**

Find and replace all route registrations:

- `router.get('/persona',` → `router.get('/config',`
- `router.put('/persona',` → `router.put('/config',`

Keep `/avatar`, `/voices`, `/voices/:id`, `/voices/:id/preview` unchanged (they're sub-resources, not config).

- [ ] **Step 3: Gate all mutation routes with admin auth**

Add `requireAdmin` check at the start of these handlers:

- `PUT /config` (currently `/persona`)
- `POST /avatar`
- `POST /voices`
- `DELETE /voices/:id`

Pattern for each:

```typescript
router.put('/config', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  // ... existing handler body
});
```

- [ ] **Step 4: Expand PUT /config to accept new fields**

In the `PUT /config` handler, expand the destructuring and store.update() call to include new fields:

```typescript
router.put('/config', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { copilotName, activeVoiceId, copilotColor, siteTitle,
          greetingMessage, farewellMessage, systemPromptIntro, language } = req.body;
  await store.update({
    ...(copilotName !== undefined && { copilotName }),
    ...(activeVoiceId !== undefined && { activeVoiceId }),
    ...(copilotColor !== undefined && { copilotColor }),
    ...(siteTitle !== undefined && { siteTitle }),
    ...(greetingMessage !== undefined && { greetingMessage }),
    ...(farewellMessage !== undefined && { farewellMessage }),
    ...(systemPromptIntro !== undefined && { systemPromptIntro }),
    ...(language !== undefined && { language }),
  });
  const config = store.getFullConfig();
  // Broadcast to WebSocket clients
  options.broadcast?.({ type: 'config.updated', config });
  res.json({ ...config, avatarUrl: getAvatarDataUri() });
});
```

- [ ] **Step 5: Update GET /config to return full merged config**

Replace the current GET handler response with:

```typescript
router.get('/config', (_req, res) => {
  const config = store.getFullConfig();
  res.json({ ...config, avatarUrl: getAvatarDataUri() });
});
```

Reuses the existing `getAvatarDataUri()` sync helper (already defined in the file) instead of duplicating the avatar-to-data-URI logic.

- [ ] **Step 6: Verify build**

```bash
cd packages/server && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/createPersonaRoutes.ts
git commit -m "feat: rename to /config, add admin auth, broadcast on settings change"
```

### Task 4: Expose broadcast from WebSocket handler

**Files:**
- Modify: `packages/server/src/createVoiceWebSocketHandler.ts`

- [ ] **Step 1: Change return type to expose broadcast**

Change function signature from:

```typescript
export function createVoiceWebSocketHandler(server: HttpServer, options: VoiceServerOptions): void
```

To:

```typescript
export function createVoiceWebSocketHandler(
  server: HttpServer,
  options: VoiceServerOptions,
): { broadcast: (event: Record<string, unknown>) => void }
```

- [ ] **Step 2: Track connections and implement broadcast**

After `wss` creation, add a connection set and broadcast function:

```typescript
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  // ... existing connection handler
});

function broadcast(event: Record<string, unknown>) {
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

return { broadcast };
```

Note: the existing `ws.on('close')` handler inside the connection callback has cleanup logic (cancels pipeline, closes STT). The new `clients.delete(ws)` should be added alongside it, not replace it.

- [ ] **Step 3: Verify build**

```bash
cd packages/server && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/createVoiceWebSocketHandler.ts
git commit -m "feat: expose broadcast function from WebSocket handler"
```

### Task 5: Wire everything in attachVoicePipeline

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Pass siteConfig to PersonaStore**

Find the PersonaStore instantiation (around line 15) and add `options.config`:

```typescript
// Before:
const personaStore = new PersonaStore(options.personaDir!);
// After:
const personaStore = new PersonaStore(options.personaDir!, options.config);
```

- [ ] **Step 2: Capture broadcast from WebSocket handler**

Change the `createVoiceWebSocketHandler` call to capture the return value:

```typescript
// Before:
createVoiceWebSocketHandler(server, { ...options, getActiveVoiceId });
// After:
const { broadcast } = createVoiceWebSocketHandler(server, { ...options, getActiveVoiceId });
```

- [ ] **Step 3: Pass adminPassword and broadcast to persona routes**

The current call (around line 31) is:

```typescript
const { router } = createPersonaRoutes({
  personaDir: options.personaDir!,
  ttsUpstreamUrl: /* ... TTS URL resolution ... */,
  store: personaStore,
});
```

Add `adminPassword` and `broadcast` to the options object:

```typescript
const { router } = createPersonaRoutes({
  personaDir: options.personaDir!,
  ttsUpstreamUrl: /* ... TTS URL resolution unchanged ... */,
  store: personaStore,
  adminPassword: options.adminPassword,
  broadcast,
});
```

- [ ] **Step 4: Verify build**

```bash
cd packages/server && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: wire siteConfig, broadcast, and adminPassword through pipeline"
```

---

## Chunk 3: Client — API, Hook, UI

### Task 6: Extend client PersonaApi

**Files:**
- Modify: `packages/core/src/services/personaApi.ts`

- [ ] **Step 1: Extend PersonaData with shared settings**

```typescript
export interface PersonaData {
  copilotName: string;
  avatarUrl: string;
  activeVoiceId: string;
  voices: VoiceEntry[];
  // Shared settings
  copilotColor: string;
  siteTitle: string;
  greetingMessage: string;
  farewellMessage: string;
  systemPromptIntro: string;
  language: string;
}
```

- [ ] **Step 2: Rename endpoint from /persona to /config**

In `getPersona()` method, change:

```typescript
const res = await fetch(`${this.baseUrl}/persona`, {
```

To:

```typescript
const res = await fetch(`${this.baseUrl}/config`, {
```

Rename method from `getPersona()` to `getConfig()` (keep `getPersona` as alias for backward compat):

```typescript
async getConfig(): Promise<PersonaData | null> {
  // ... existing body with /config endpoint
}

/** @deprecated Use getConfig() */
async getPersona(): Promise<PersonaData | null> {
  return this.getConfig();
}
```

- [ ] **Step 3: Update updatePersona to accept all fields + admin password**

Rename to `updateConfig` with backward compat alias:

```typescript
async updateConfig(
  data: Partial<Omit<PersonaData, 'avatarUrl' | 'voices'>>,
  adminPassword?: string,
): Promise<PersonaData> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...this.authHeaders(),
  };
  if (adminPassword) {
    headers['X-Admin-Password'] = adminPassword;
  }
  const res = await fetch(`${this.baseUrl}/config`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Update config failed: ${res.status}`);
  return res.json();
}

/** @deprecated Use updateConfig() */
async updatePersona(data: { copilotName?: string; activeVoiceId?: string }): Promise<PersonaData> {
  return this.updateConfig(data);
}
```

- [ ] **Step 4: Add admin password to avatar and voice mutation methods**

Add optional `adminPassword` parameter to `uploadAvatar`, `uploadVoice`, `deleteVoice`:

```typescript
async uploadAvatar(file: File, adminPassword?: string): Promise<string> {
  const headers: Record<string, string> = { ...this.authHeaders() };
  if (adminPassword) headers['X-Admin-Password'] = adminPassword;
  // ... rest unchanged
}
```

Same pattern for `uploadVoice` and `deleteVoice`.

- [ ] **Step 5: Verify build**

```bash
cd packages/core && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/personaApi.ts
git commit -m "feat: extend PersonaApi with shared settings and admin auth"
```

### Task 7: Add WebSocket listener to usePersona

**Files:**
- Modify: `packages/core/src/hooks/usePersona.ts`

- [ ] **Step 1: Accept WebSocket message source**

Add an optional parameter for receiving WebSocket messages. The voice WebSocket already exists — the hook needs a way to subscribe to its messages. Add a parameter:

```typescript
export function usePersona(
  endpoint: string | undefined,
  wsMessages?: { onMessage: (handler: (data: any) => void) => () => void },
): UsePersonaResult {
```

`wsMessages.onMessage` registers a handler and returns an unsubscribe function.

- [ ] **Step 2: Listen for config.updated events**

Inside the hook, add a `useEffect` that subscribes to WebSocket messages:

```typescript
useEffect(() => {
  if (!wsMessages) return;
  const unsub = wsMessages.onMessage((data) => {
    if (data.type === 'config.updated' && data.config) {
      const cached = personaCache.get(cacheKey);
      const updated = { ...cached, ...data.config };
      personaCache.set(cacheKey, updated);
      setPersona(updated);
    }
  });
  return unsub;
}, [wsMessages, cacheKey]);
```

- [ ] **Step 3: Expose updateConfig in return value**

Add to the return interface and implementation:

```typescript
export interface UsePersonaResult {
  // ... existing fields
  updateConfig: (fields: Partial<PersonaData>, adminPassword?: string) => Promise<void>;
}
```

Implementation:

```typescript
const updateConfig = useCallback(async (
  fields: Partial<Omit<PersonaData, 'avatarUrl' | 'voices'>>,
  adminPassword?: string,
) => {
  if (!apiRef.current) return;
  const updated = await apiRef.current.updateConfig(fields, adminPassword);
  personaCache.set(cacheKey, updated);
  setPersona(updated);
}, [cacheKey]);
```

- [ ] **Step 4: Verify build**

```bash
cd packages/core && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hooks/usePersona.ts
git commit -m "feat: add WebSocket listener and updateConfig to usePersona"
```

### Task 8: Add Copilot settings section to UI

**Files:**
- Modify: `packages/ui/src/components/VoiceSettingsView.tsx`
- Modify: `packages/ui/src/components/PersonaSettings.tsx`

- [ ] **Step 1: Add admin auth state to PersonaSettings**

In `PersonaSettings.tsx`, add state for admin authentication:

```typescript
const [adminPassword, setAdminPassword] = useState<string | null>(
  () => sessionStorage.getItem('voice-admin-pw')
);
const [authError, setAuthError] = useState('');
const isAdmin = adminPassword !== null;
```

Add an `onAdminLogin` handler:

```typescript
const handleAdminLogin = useCallback(async (pw: string) => {
  try {
    // Test the password by attempting a no-op update
    await persona.updateConfig({}, pw);
    sessionStorage.setItem('voice-admin-pw', pw);
    setAdminPassword(pw);
    setAuthError('');
  } catch {
    setAuthError('Invalid password');
  }
}, [persona]);
```

- [ ] **Step 2: Add password prompt UI**

If `!isAdmin`, show an "Admin" button that expands an inline password input:

```typescript
const [showPasswordInput, setShowPasswordInput] = useState(false);
const [passwordInput, setPasswordInput] = useState('');

// In JSX:
{!isAdmin && (
  <div style={{ padding: '12px 16px' }}>
    {!showPasswordInput ? (
      <button onClick={() => setShowPasswordInput(true)}
        style={{ /* subtle button style */ }}>
        Admin settings
      </button>
    ) : (
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          placeholder="Admin password"
          value={passwordInput}
          onChange={e => setPasswordInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdminLogin(passwordInput)}
          style={{ /* input style */ }}
        />
        <button onClick={() => handleAdminLogin(passwordInput)}>OK</button>
        {authError && <span style={{ color: '#e53e3e' }}>{authError}</span>}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Add Copilot settings fields**

When `isAdmin`, render the shared settings fields below the existing persona sections. Use the existing `SliderSetting`, `ToggleSetting`, `SelectSetting` components from `VoiceSettingsView.tsx` where appropriate, and simple labeled inputs for text/textarea:

```typescript
{isAdmin && (
  <>
    {/* Color picker */}
    <SettingRow label="Copilot color">
      <input type="color"
        value={persona?.copilotColor || '#1B5E20'}
        onChange={e => handleSharedSave({ copilotColor: e.target.value })}
      />
    </SettingRow>

    {/* Site title */}
    <SettingRow label="Site title">
      <input type="text"
        value={persona?.siteTitle || ''}
        onBlur={e => handleSharedSave({ siteTitle: e.target.value })}
      />
    </SettingRow>

    {/* Greeting */}
    <SettingRow label="Greeting message">
      <textarea
        value={persona?.greetingMessage || ''}
        onBlur={e => handleSharedSave({ greetingMessage: e.target.value })}
      />
    </SettingRow>

    {/* Farewell */}
    <SettingRow label="Farewell message">
      <textarea
        value={persona?.farewellMessage || ''}
        onBlur={e => handleSharedSave({ farewellMessage: e.target.value })}
      />
    </SettingRow>

    {/* System prompt intro */}
    <SettingRow label="System prompt intro">
      <textarea rows={4}
        value={persona?.systemPromptIntro || ''}
        onBlur={e => handleSharedSave({ systemPromptIntro: e.target.value })}
      />
    </SettingRow>

    {/* Language */}
    <SettingRow label="Default language">
      <select
        value={persona?.language || 'en'}
        onChange={e => handleSharedSave({ language: e.target.value })}
      >
        {LANGUAGE_OPTIONS.map(l => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>
    </SettingRow>
  </>
)}
```

Where `handleSharedSave` is:

```typescript
const handleSharedSave = useCallback(async (fields: Record<string, string>) => {
  if (!adminPassword) return;
  await persona.updateConfig(fields, adminPassword);
}, [adminPassword, persona]);
```

And `LANGUAGE_OPTIONS` reuses the existing array from `VoiceSettingsView.tsx` (import or extract to shared constant).

- [ ] **Step 4: Gate existing persona mutations behind admin auth**

Pass `adminPassword` to existing handlers in PersonaSettings:

- `uploadAvatar(file)` → `uploadAvatar(file, adminPassword)`
- `uploadVoice(file, name)` → `uploadVoice(file, name, adminPassword)`
- `deleteVoice(id)` → `deleteVoice(id, adminPassword)`
- `updateName(name)` → `updateConfig({ copilotName: name }, adminPassword)`

If `!isAdmin`, hide or disable the edit/upload/delete buttons in avatar and voice sections.

- [ ] **Step 5: Verify build**

```bash
cd packages/ui && npx tsc --noEmit
```

- [ ] **Step 6: Manual test**

```bash
cd packages/server && npm run dev
# In another terminal, test the API:
# GET config (no auth needed)
curl http://localhost:3001/api/agent/config | jq .

# PUT config (requires admin password)
curl -X PUT http://localhost:3001/api/agent/config \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-Password: admin' \
  -d '{"greetingMessage": "Hello from the API!"}'

# PUT without password (should 401)
curl -X PUT http://localhost:3001/api/agent/config \
  -H 'Content-Type: application/json' \
  -d '{"greetingMessage": "Should fail"}'
```

Expected: GET returns merged config, PUT with password succeeds, PUT without password returns 401.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/VoiceSettingsView.tsx packages/ui/src/components/PersonaSettings.tsx
git commit -m "feat: add copilot settings section with admin gate to settings panel"
```

---

## Chunk 4: Scaffold & Cleanup

### Task 9: Update scaffold template

**Files:**
- Modify: `../voice-agent-action/templates/server/.env.example` (if accessible, otherwise note for separate PR)

- [ ] **Step 1: Add ADMIN_PASSWORD to .env.example**

Add to the server .env.example template:

```
ADMIN_PASSWORD=admin        # Password for shared settings admin UI
```

- [ ] **Step 2: Update consuming project template index.ts**

In `../voice-agent-action/templates/server/index.ts`, ensure `adminPassword` is passed:

The current template already passes all options to `attachVoicePipeline`. If `ADMIN_PASSWORD` is in the env, it needs to be passed:

```typescript
attachVoicePipeline(server, app, {
  // ... existing options
  adminPassword: process.env.ADMIN_PASSWORD,
});
```

Check the current template — if `attachVoicePipeline` is called with a spread of env-derived options, `adminPassword` may need explicit addition.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat: add ADMIN_PASSWORD to scaffold templates"
```

### Task 10: Final integration test

- [ ] **Step 1: Full build**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit
npm run build  # or equivalent workspace build
```

Expected: All packages build without errors.

- [ ] **Step 2: Start a consuming project locally**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya
# Start backend
cd server && ADMIN_PASSWORD=admin npm run dev &
# Start frontend
cd .. && npm run dev &
```

- [ ] **Step 3: Verify settings flow end-to-end**

1. Open the voice agent settings panel
2. Click "Admin settings" → enter "admin" → should unlock
3. Change greeting message → verify it saves (check persona.json on disk)
4. Open a second browser tab → verify it picks up the new greeting on load
5. With both tabs open and voice panel active, change color in tab 1 → tab 2 should update via WebSocket

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: integration test verification"
```
