# Batch 4: Settings Polish + Persona Experience

## Summary

Polish the settings UI with save feedback and accessibility, then implement the virtual civil servant persona adaptations and audio/visual enhancements.

## Changes

### 1. Save confirmation feedback

When an admin edits a field and it saves on blur, show a brief "Saved" indicator. On failure, show an inline error.

**Behavior:**
- On successful save: show a small "Saved" text (green, 11px) next to the field label. Fade in, hold 1.5s, fade out.
- On failure: show error text (red, 11px) next to the field label. Stays until next edit.
- Apply to all `TextInputSetting` and `ColorInputSetting` fields in the Agent section.
- The `handleSharedSave` callback needs to return success/failure status.

**Files:**
- Modify: `packages/ui/src/components/VoiceSettingsView.tsx` (TextInputSetting, ColorInputSetting, handleSharedSave)

### 2. Focus rings on PersonaSettings inputs

The old `TextSettingRow`, `TextAreaSettingRow`, and `ColorSettingRow` components in PersonaSettings have `outline: 'none'` with no focus indicator. Add a visible border change on focus, matching the pattern in `TextInputSetting`.

**Files:**
- Modify: `packages/ui/src/components/PersonaSettings.tsx` (TextSettingRow, TextAreaSettingRow — add onFocus/onBlur border change)

### 3. System prompt — virtual civil servant persona

Adapt `systemPrompt.ts` to support `{name}` and `{siteTitle}` template variables in the `systemPromptIntro`. The system prompt builder should replace these at render time.

**Key adaptations:**
- Replace `{name}` with `copilotName` and `{siteTitle}` with `siteTitle` in the intro
- Add a "virtual civil servant" tone section: professional, courteous, service-oriented
- Follow the CLAUDE.md process: baseline compliance test → modify → re-test → A/B test

**Files:**
- Modify: `packages/server/src/systemPrompt.ts` (add variable replacement, update TONE section)

### 4. Sound feedback on mic toggle

Play a subtle audio cue when the mic activates and deactivates.

**Design:**
- Mic on: short rising tone (~100ms, 440Hz → 660Hz)
- Mic off: short falling tone (~100ms, 660Hz → 440Hz)
- Generated via Web Audio API OscillatorNode — no audio file assets
- Volume follows `settings.volume`
- Disabled when `prefers-reduced-motion` is preferred
- Gated behind `SiteConfig.micSoundEnabled?: boolean` (default: true)

**Files:**
- Create: `packages/core/src/utils/micSound.ts`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts` (call sounds in start/stop)
- Modify: `packages/core/src/types/config.ts` (add micSoundEnabled)

### 5. Suggested prompt chips in voice mode

When the mic is paused and there are no messages, show the suggestion chips above the composer bar.

**Behavior:**
- Show horizontally scrollable chips above the composer bar
- Only visible when: `micPaused === true` AND `messages.length === 0`
- Tapping a chip sends as text message (same as empty state chips)
- Chips disappear after first message or when mic starts

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx` (add chips above ComposerBar in ExpandedContent)

## Not in scope

- Custom sound assets (WAV/MP3) for mic toggle
- Per-country persona variations (handled by consuming project's systemPromptIntro)
- Reset to defaults feature
- Preview of suggested prompts in settings
