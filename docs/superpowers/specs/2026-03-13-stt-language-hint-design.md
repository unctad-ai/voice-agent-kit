# STT Language Hint — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Problem:** Kyutai STT auto-detects language and hallucinated Turkish from English speech. No language hint is sent from client or configured per project.

## Overview

Add a `language` field that flows from `SiteConfig` (project default) through `VoiceSettings` (user override) to both STT providers (Kyutai, Groq). This eliminates wrong-language hallucinations and gives users control.

## Changes by Package

### 1. `core` — Types & Config

**`types/config.ts`** — Add to `SiteConfig`:
```ts
/** BCP-47 language code for STT (e.g. 'en', 'fr', 'sw'). Defaults to 'en'. */
language?: string;
```

**`types/settings.ts`** — Add to `VoiceSettings`:
```ts
language: string;
```

Note: The UI package has its own copy of `VoiceSettings` in `contexts/VoiceSettingsContext.tsx`. Both must be updated in sync.

**`config/defaults.ts`** — Add:
```ts
export const DEFAULT_LANGUAGE = 'en';
```

### 2. `core` — Voice API Client

**`services/voiceApi.ts`** — `transcribeAudio` gains a `language` param:
```ts
export async function transcribeAudio(
  wavBlob: Blob,
  signal?: AbortSignal,
  timeoutMs?: number,
  language?: string,
): Promise<...> {
  const formData = new FormData();
  formData.append('audio', wavBlob, 'audio.wav');
  if (language) formData.append('language', language);
  // ...rest unchanged
}
```

### 3. `core` — useVoiceAgent Hook

**`hooks/useVoiceAgent.ts`** — Pass language from settings to STT call:
```ts
const result = await transcribeAudio(
  wavBlob,
  undefined,
  settingsRef.current.sttTimeoutMs,
  settingsRef.current.language,
);
```

### 4. `ui` — VoiceSettingsContext

**`contexts/VoiceSettingsContext.tsx`**:
- Import `DEFAULT_LANGUAGE` from core
- Add `language: string` to the local `VoiceSettings` interface (mirrors core)
- Add `language: DEFAULT_LANGUAGE` to `DEFAULTS`
- Change `VoiceSettingsProvider` props from `{ children }` to `{ children, siteLanguage? }`:
  ```ts
  interface VoiceSettingsProviderProps {
    children: ReactNode;
    siteLanguage?: string;
  }
  ```
- On first load (no `language` in localStorage), use `siteLanguage ?? DEFAULT_LANGUAGE` as the initial value
- `resetSettings` must also reset to `siteLanguage` (not just `DEFAULTS`). Capture `siteLanguage` in a ref and merge it into the reset:
  ```ts
  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULTS, language: siteLanguageRef.current ?? DEFAULT_LANGUAGE };
    setSettings(defaults);
    persistSettings(defaults);
    // ...existing ref resets
  }, []);
  ```

### 5. `ui` — VoiceSettingsView (Listening section)

**`components/VoiceSettingsView.tsx`**:
- Add `Globe` to the lucide-react import list
- Add a `SelectSetting` for language in the Listening section, above Auto-listen:

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

Language options (Whisper-compatible BCP-47 codes):
| Code | Label |
|------|-------|
| `en` | English |
| `fr` | French |
| `es` | Spanish |
| `sw` | Swahili |
| `pt` | Portuguese |
| `ar` | Arabic |
| `zh` | Chinese |
| `hi` | Hindi |
| `dz` | Dzongkha |

### 6. `ui` — VoiceAgentProvider

**`VoiceAgentProvider.tsx`** — Pass `config.language` to `VoiceSettingsProvider` as `siteLanguage` prop so it initializes correctly per project:
```tsx
<VoiceSettingsProvider siteLanguage={config.language}>
```

### 7. `server` — STT Handler

**`createSttHandler.ts`**:

Read `language` from multipart form field in the route handler:
```ts
const language = (req.body?.language as string) || 'en';
```

Thread `language` into both provider functions by adding it as a parameter:

**`transcribeWithKyutai(wavBuffer, language)`** — updated signature, appends to FormData:
```ts
async function transcribeWithKyutai(wavBuffer: Buffer, language: string): Promise<STTResponse> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
  formData.append('file', blob, 'audio.wav');
  formData.append('language', language);
  // ...rest unchanged
  return {
    text: data.text,
    language,  // return the hint language, not hardcoded 'en'
    noSpeechProb,
    avgLogprob,
  };
}
```

**`transcribeWithGroq(wavBuffer, language)`** — updated signature, passes to API:
```ts
async function transcribeWithGroq(wavBuffer: Buffer, language: string): Promise<STTResponse> {
  // ...existing setup
  const transcription = await getGroq().audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    temperature: 0,
    response_format: 'verbose_json',
    language,
  });
  // ...rest unchanged
}
```

Both providers accept a BCP-47 language code. Kyutai's `/v1/audio/transcriptions` follows the OpenAI-compatible API and accepts `language` as a form field. Groq's Whisper API accepts it as a parameter.

## Data Flow

```
SiteConfig.language ('en')
       │
       ▼
VoiceSettingsProvider(siteLanguage=config.language)
       │
       ▼
VoiceSettings.language (user can override via UI, persisted in localStorage)
       │
       ▼
useVoiceAgent → transcribeAudio(blob, signal, timeout, language)
       │
       ▼
POST /api/stt  [FormData: audio + language]
       │
       ▼
createSttHandler → reads language from req.body
       │
       ├──► transcribeWithKyutai(buffer, language) → FormData.append('language', language)
       └──► transcribeWithGroq(buffer, language) → transcriptions.create({ language })
```

## Edge Cases

- **No language in request**: Server defaults to `'en'`
- **Invalid language code**: Whisper/Kyutai ignore unknown codes and fall back to auto-detect — still better than no hint
- **Reset settings**: Resets to `siteLanguage` from SiteConfig (not hardcoded `'en'`)
- **Existing localStorage**: Old settings without `language` merge with defaults — gets `DEFAULT_LANGUAGE` via spread
- **Kyutai response language**: Returns the hint language sent, not hardcoded `'en'`
- **Kyutai error fallback**: The catch block in the route handler (`response = { text: '', language: 'en', ... }`) must also use the parsed `language` variable instead of hardcoded `'en'`
- **Core barrel export**: `DEFAULT_LANGUAGE` is covered by the existing `export * from './config/defaults'` in `core/src/index.ts` — no new export needed

## Not in Scope

- Per-utterance language detection (auto-detect with correction)
- Language affecting LLM system prompt or TTS voice selection
- UI localization / i18n of the settings panel itself
