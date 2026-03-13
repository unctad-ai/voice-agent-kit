# STT Language Hint Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass a language hint from SiteConfig/Settings UI through to Kyutai and Groq STT providers, eliminating wrong-language hallucinations.

**Architecture:** New `language` field flows: `SiteConfig` (project default) → `VoiceSettings` (user-overridable, persisted in localStorage) → `transcribeAudio()` client call → server STT handler → provider APIs. Each layer adds the field to its existing interface/function.

**Tech Stack:** TypeScript, React, Express/multer, Groq SDK, tsup

**Spec:** `docs/superpowers/specs/2026-03-13-stt-language-hint-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/core/src/config/defaults.ts` | Add `DEFAULT_LANGUAGE` constant |
| Modify | `packages/core/src/types/config.ts` | Add `language?` to `SiteConfig` |
| Modify | `packages/core/src/types/settings.ts` | Add `language` to `VoiceSettings` |
| Modify | `packages/core/src/services/voiceApi.ts` | Add `language` param to `transcribeAudio` |
| Modify | `packages/core/src/hooks/useVoiceAgent.ts` | Pass `settings.language` to STT call |
| Modify | `packages/ui/src/contexts/VoiceSettingsContext.tsx` | Add `language` to settings + `siteLanguage` prop |
| Modify | `packages/ui/src/components/VoiceSettingsView.tsx` | Language dropdown in Listening section |
| Modify | `packages/ui/src/VoiceAgentProvider.tsx` | Thread `config.language` to settings provider |
| Modify | `packages/server/src/createSttHandler.ts` | Read language from request, pass to providers |

---

## Task 1: Core types and defaults

**Files:**
- Modify: `packages/core/src/config/defaults.ts:157` (after `DEFAULT_MAX_HISTORY_MESSAGES`)
- Modify: `packages/core/src/types/config.ts:66` (after `personaEndpoint`)
- Modify: `packages/core/src/types/settings.ts:25` (after `maxHistoryMessages`)

- [ ] **Step 1: Add DEFAULT_LANGUAGE to defaults.ts**

In `packages/core/src/config/defaults.ts`, add after line 157 (`DEFAULT_MAX_HISTORY_MESSAGES`):
```ts
export const DEFAULT_LANGUAGE = 'en';
```

- [ ] **Step 2: Add language and greetingMessage to SiteConfig**

In `packages/core/src/types/config.ts`, add after `personaEndpoint` (line 66):
```ts
/** BCP-47 language code for STT (e.g. 'en', 'fr', 'sw'). Defaults to 'en'. */
language?: string;

/** Initial greeting shown/spoken when the panel opens. */
greetingMessage?: string;
```

- [ ] **Step 3: Add language to VoiceSettings**

In `packages/core/src/types/settings.ts`, add after `maxHistoryMessages` (line 25):
```ts
language: string;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: Type errors in `ui` package (VoiceSettingsContext missing `language` in its copy) — that's expected, fixed in Task 3.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/defaults.ts packages/core/src/types/config.ts packages/core/src/types/settings.ts
git commit -m "feat(core): add language, greetingMessage to SiteConfig and language to VoiceSettings"
```

---

## Task 2: Client-side STT call

**Files:**
- Modify: `packages/core/src/services/voiceApi.ts:12-31`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:802-806`

- [ ] **Step 1: Add language param to transcribeAudio**

In `packages/core/src/services/voiceApi.ts`, update the function signature and body:

```ts
export async function transcribeAudio(
  wavBlob: Blob,
  signal?: AbortSignal,
  timeoutMs?: number,
  language?: string,
): Promise<{ text: string; language: string; noSpeechProb: number; avgLogprob: number }> {
  const formData = new FormData();
  formData.append('audio', wavBlob, 'audio.wav');
  if (language) formData.append('language', language);

  const timeout = AbortSignal.timeout(timeoutMs ?? STT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(`${BACKEND_URL}/api/stt`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
    signal: combined,
  });

  if (!res.ok) throw new Error(`STT failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Pass settings.language in useVoiceAgent**

In `packages/core/src/hooks/useVoiceAgent.ts`, update the `transcribeAudio` call (~line 802):

From:
```ts
const result = await transcribeAudio(
  wavBlob,
  undefined,
  settingsRef.current.sttTimeoutMs
);
```

To:
```ts
const result = await transcribeAudio(
  wavBlob,
  undefined,
  settingsRef.current.sttTimeoutMs,
  settingsRef.current.language,
);
```

- [ ] **Step 3: Typecheck core**

Run: `cd packages/core && pnpm typecheck`
Expected: PASS (useVoiceAgent reads from `VoiceSettings` which now has `language`)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/voiceApi.ts packages/core/src/hooks/useVoiceAgent.ts
git commit -m "feat(core): pass language hint to STT endpoint"
```

---

## Task 3: UI settings — context, provider, dropdown

**Files:**
- Modify: `packages/ui/src/contexts/VoiceSettingsContext.tsx`
- Modify: `packages/ui/src/VoiceAgentProvider.tsx`
- Modify: `packages/ui/src/components/VoiceSettingsView.tsx`

- [ ] **Step 1: Update VoiceSettingsContext**

In `packages/ui/src/contexts/VoiceSettingsContext.tsx`:

1. Add `DEFAULT_LANGUAGE` to the import from core (line 1-21):
```ts
import {
  // ...existing imports...
  DEFAULT_LANGUAGE,
} from '@unctad-ai/voice-agent-core';
```

2. Add `language: string` to the local `VoiceSettings` interface (after line 41, `maxHistoryMessages`):
```ts
language: string;
```

3. Add to `DEFAULTS` (after `maxHistoryMessages` line 62):
```ts
language: DEFAULT_LANGUAGE,
```

4. Change the provider props and add `siteLanguage` support:

Replace `export function VoiceSettingsProvider({ children }: { children: ReactNode })` with:
```ts
interface VoiceSettingsProviderProps {
  children: ReactNode;
  siteLanguage?: string;
}

export function VoiceSettingsProvider({ children, siteLanguage }: VoiceSettingsProviderProps) {
```

5. Add a ref for siteLanguage (after the `speedRef` line ~102):
```ts
const siteLanguageRef = useRef(siteLanguage);
siteLanguageRef.current = siteLanguage;
```

6. Update `loadSettings` usage to merge siteLanguage. Change the `useState` initializer (line 98):

From:
```ts
const [settings, setSettings] = useState<VoiceSettings>(loadSettings);
```
To:
```ts
const [settings, setSettings] = useState<VoiceSettings>(() => {
  const loaded = loadSettings();
  // If no language was explicitly persisted by the user, use site-level default
  if (siteLanguage) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const hasPersisted = raw ? Object.prototype.hasOwnProperty.call(JSON.parse(raw), 'language') : false;
      if (!hasPersisted) loaded.language = siteLanguage;
    } catch {
      loaded.language = siteLanguage;
    }
  }
  return loaded;
});
```

7. Update `resetSettings` to respect siteLanguage:

From:
```ts
const resetSettings = useCallback(() => {
  const defaults = { ...DEFAULTS };
  setSettings(defaults);
  persistSettings(defaults);
  volumeRef.current = defaults.volume;
  speedRef.current = defaults.playbackSpeed;
}, []);
```
To:
```ts
const resetSettings = useCallback(() => {
  const defaults = { ...DEFAULTS, language: siteLanguageRef.current ?? DEFAULT_LANGUAGE };
  setSettings(defaults);
  persistSettings(defaults);
  volumeRef.current = defaults.volume;
  speedRef.current = defaults.playbackSpeed;
}, []);
```

- [ ] **Step 2: Thread siteLanguage in VoiceAgentProvider**

In `packages/ui/src/VoiceAgentProvider.tsx`, change line 16:

From:
```tsx
<VoiceSettingsProvider>
```
To:
```tsx
<VoiceSettingsProvider siteLanguage={config.language}>
```

- [ ] **Step 3: Add language dropdown to VoiceSettingsView**

In `packages/ui/src/components/VoiceSettingsView.tsx`:

1. Add `Globe` to the lucide-react import (line 29, before the closing `}`):
```ts
Globe,
```

2. Add language options constant before the component (after the `bargeInLabel` function, ~line 55):
```ts
const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'sw', label: 'Swahili' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'dz', label: 'Dzongkha' },
];
```

3. Add the language selector in the Listening section, as the first item before Auto-listen. Insert before the `<ToggleSetting` for auto-listen (~line 384):
```tsx
<SelectSetting
  icon={<Globe style={iconStyle} />}
  label="Language"
  value={settings.language}
  onChange={(v) => updateSetting('language', v)}
  options={LANGUAGE_OPTIONS}
/>
<Divider />
```

- [ ] **Step 4: Typecheck all packages**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Build all packages**

Run: `pnpm build`
Expected: PASS — tsup builds UI, tsc builds core/registries/server

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/contexts/VoiceSettingsContext.tsx packages/ui/src/VoiceAgentProvider.tsx packages/ui/src/components/VoiceSettingsView.tsx
git commit -m "feat(ui): add language selector to Listening settings"
```

---

## Task 4: Server — forward language to STT providers

**Files:**
- Modify: `packages/server/src/createSttHandler.ts`

- [ ] **Step 1: Add language param to transcribeWithKyutai**

In `packages/server/src/createSttHandler.ts`, update `transcribeWithKyutai` (line 42):

From:
```ts
async function transcribeWithKyutai(wavBuffer: Buffer): Promise<STTResponse> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
  formData.append('file', blob, 'audio.wav');
```
To:
```ts
async function transcribeWithKyutai(wavBuffer: Buffer, language: string): Promise<STTResponse> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
  formData.append('file', blob, 'audio.wav');
  formData.append('language', language);
```

Also update the return value (line 72-77) — change `language: 'en'` to `language`:
```ts
return {
  text: data.text,
  language,
  noSpeechProb,
  avgLogprob,
};
```

- [ ] **Step 2: Add language param to transcribeWithGroq**

Update `transcribeWithGroq` (line 81):

From:
```ts
async function transcribeWithGroq(wavBuffer: Buffer): Promise<STTResponse> {
```
To:
```ts
async function transcribeWithGroq(wavBuffer: Buffer, language: string): Promise<STTResponse> {
```

Add `language` to the `transcriptions.create` call (after `temperature: 0,` line 88):
```ts
language,
```

Also update the return value (line 108-113) — change `language: verbose.language ?? 'en'` to use the hint language for consistency with Kyutai:
```ts
return {
  text: transcription.text,
  language,
  noSpeechProb,
  avgLogprob,
};
```

- [ ] **Step 3: Update route handler to read and thread language**

In the route handler (line 117+), read language from the multipart body and pass to providers.

After `const t0 = performance.now();` (line 126), add:
```ts
const language = (req.body?.language as string) || 'en';
```

Update the Kyutai call (line 130):
From:
```ts
response = await transcribeWithKyutai(req.file.buffer);
```
To:
```ts
response = await transcribeWithKyutai(req.file.buffer, language);
```

Update the Kyutai error fallback (line 133):
From:
```ts
response = { text: '', language: 'en', noSpeechProb: 1, avgLogprob: 0 };
```
To:
```ts
response = { text: '', language, noSpeechProb: 1, avgLogprob: 0 };
```

Update the Groq call (line 136):
From:
```ts
response = await transcribeWithGroq(req.file.buffer);
```
To:
```ts
response = await transcribeWithGroq(req.file.buffer, language);
```

- [ ] **Step 4: Typecheck server**

Run: `cd packages/server && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Typecheck all + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/createSttHandler.ts
git commit -m "feat(server): forward language hint to Kyutai and Groq STT providers"
```

---

## Task 5: Release

- [ ] **Step 1: Create changeset**

```bash
cat > .changeset/stt-language-hint.md << 'EOF'
---
"@unctad-ai/voice-agent-core": minor
"@unctad-ai/voice-agent-ui": minor
"@unctad-ai/voice-agent-server": minor
---

Add language hint to STT pipeline — configurable per project via SiteConfig.language and per user via Settings UI. Fixes wrong-language transcription hallucinations (e.g. Turkish from English speech). Also adds greetingMessage to SiteConfig for scaffold type safety.
EOF
```

- [ ] **Step 2: Commit changeset**

```bash
git add .changeset/stt-language-hint.md
git commit -m "chore: add changeset for STT language hint"
```

- [ ] **Step 3: Release**

```bash
./scripts/release.sh --yes
```

- [ ] **Step 4: Verify Kenya deployment picks up new version**

Check that the voice-agent-action rebuilds Kenya's `voice-agent` branch with the new kit version and the language dropdown appears in Settings → Listening.
