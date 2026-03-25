# Settings Polish + Persona Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish settings UI with save feedback and accessibility, add mic toggle sounds, and show suggestion chips in voice mode.

**Architecture:** Five independent changes across `ui`, `core`, and `server` packages. Tasks 1+2 are settings UI polish (same package, different components). Task 3 is system prompt template variables. Task 4 is a new Web Audio utility + hook integration. Task 5 is a UI-only chip display in the composer area.

**Tech Stack:** React (inline styles), Web Audio API, Vitest, motion/react for animations.

**Spec:** `docs/superpowers/specs/2026-03-25-settings-polish-and-persona.md`

**Impeccable skills to invoke during implementation:**
- `impeccable:polish` — after Tasks 1+2, review settings UI for alignment/spacing consistency
- `impeccable:harden` — after Task 2, verify focus rings work across browsers
- `impeccable:delight` — after Task 4, refine mic sound feel (frequency, duration, gain curve)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/ui/src/components/VoiceSettingsView.tsx` | Save feedback on TextInputSetting, ColorInputSetting, handleSharedSave |
| Modify | `packages/ui/src/components/PersonaSettings.tsx` | Focus rings on TextSettingRow, TextAreaSettingRow, ColorSettingRow |
| Modify | `packages/server/src/systemPrompt.ts` | `{name}` / `{siteTitle}` template replacement |
| Modify | `packages/server/src/__tests__/systemPrompt.test.ts` | Tests for template vars |
| Create | `packages/core/src/utils/micSound.ts` | Web Audio oscillator tones |
| Modify | `packages/core/src/types/config.ts` | `micSoundEnabled` on SiteConfig |
| Modify | `packages/core/src/hooks/useVoiceAgent.ts` | Call mic sounds in start/stop |
| Modify | `packages/ui/src/components/GlassCopilotPanel.tsx` | Suggestion chips above ComposerBar |

---

## Task 1: Save Confirmation Feedback

**Files:**
- Modify: `packages/ui/src/components/VoiceSettingsView.tsx:303-434`

**Context:** `handleSharedSave` (line 430) calls `updateConfigFn(fields, adminPassword)` but returns void. `TextInputSetting` (line 303) and `ColorInputSetting` (line 378) fire `onSave` on blur but show no feedback. We need: (a) `handleSharedSave` returns success/failure, (b) `onSave` callbacks become async and return status, (c) both components show "Saved" or error text.

- [ ] **Step 1: Update `handleSharedSave` to return success/failure**

In `VoiceSettingsView.tsx`, change `handleSharedSave` (line 430-434) from:

```typescript
const handleSharedSave = useCallback(async (fields: Record<string, string>) => {
  if (!adminPassword || !updateConfigFn) return;
  try { await updateConfigFn(fields, adminPassword); }
  catch (err) { console.error('Settings save failed:', err); }
}, [adminPassword, updateConfigFn]);
```

To:

```typescript
const handleSharedSave = useCallback(async (fields: Record<string, string>): Promise<boolean> => {
  if (!adminPassword || !updateConfigFn) return false;
  try { await updateConfigFn(fields, adminPassword); return true; }
  catch (err) { console.error('Settings save failed:', err); return false; }
}, [adminPassword, updateConfigFn]);
```

- [ ] **Step 2: Add save status state to `TextInputSetting`**

Update `TextInputSetting` (line 303-374). Change `onSave` prop type from `(v: string) => void` to `(v: string) => Promise<boolean> | void`. Add save status display:

```typescript
function TextInputSetting({
  icon, label, description, value, onSave, multiline, rows = 2,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  value: string;
  onSave: (v: string) => Promise<boolean> | void;
  multiline?: boolean;
  rows?: number;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  useEffect(() => { setLocal(value); }, [value]);

  // Auto-dismiss "Saved" after 1.5s
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = setTimeout(() => setSaveStatus('idle'), 1500);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  const handleBlur = async () => {
    setFocused(false);
    if (local !== value) {
      // await is a no-op if onSave returns void
      const ok = await onSave(local);
      if (typeof ok === 'boolean') setSaveStatus(ok ? 'saved' : 'error');
    }
  };

  // ... existing inputStyle ...

  return (
    <div style={{ paddingTop: 10, paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {icon}
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
            {label}
            {saveStatus === 'saved' && (
              <span style={{ marginLeft: 6, fontSize: 11, color: '#22c55e', fontWeight: 400, transition: 'opacity 0.2s', opacity: 1 }}>Saved</span>
            )}
            {saveStatus === 'error' && (
              <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444', fontWeight: 400 }}>Save failed</span>
            )}
          </span>
          {description && <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>{description}</p>}
        </div>
      </div>
      {/* ... rest unchanged ... */}
    </div>
  );
}
```

- [ ] **Step 3: Add save status to `ColorInputSetting`**

Same pattern for `ColorInputSetting` (line 378-404):

```typescript
function ColorInputSetting({
  icon, label, value, onSave,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onSave: (v: string) => Promise<boolean> | void;
}) {
  const [local, setLocal] = useState(value);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  useEffect(() => { setLocal(value); }, [value]);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = setTimeout(() => setSaveStatus('idle'), 1500);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  const handleBlur = async () => {
    if (local !== value) {
      const ok = await onSave(local);
      if (typeof ok === 'boolean') setSaveStatus(ok ? 'saved' : 'error');
    }
  };

  return (
    <div style={{ paddingTop: 12, paddingBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      {icon}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#111827' }}>
        {label}
        {saveStatus === 'saved' && (
          <span style={{ marginLeft: 6, fontSize: 11, color: '#22c55e', fontWeight: 400 }}>Saved</span>
        )}
        {saveStatus === 'error' && (
          <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444', fontWeight: 400 }}>Save failed</span>
        )}
      </span>
      <input type="color" value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={handleBlur}
        style={{ width: 34, height: 28, border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', padding: 0 }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Build and verify**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`
Expected: clean build, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/VoiceSettingsView.tsx
git commit -m "feat(ui): add save confirmation feedback to settings inputs"
```

---

## Task 2: Focus Rings on PersonaSettings Inputs

**Files:**
- Modify: `packages/ui/src/components/PersonaSettings.tsx:134-193`

**Context:** `TextSettingRow` (line 150), `TextAreaSettingRow` (line 171), and `ColorSettingRow` (line 134) all have `outline: 'none'` with no visible focus indicator. The pattern to follow is in `TextInputSetting` in VoiceSettingsView.tsx (line 321-336): track `focused` state → toggle border color `#9ca3af` on focus, `#e5e7eb` on blur.

- [ ] **Step 1: Add focus tracking to `TextSettingRow`**

Update `TextSettingRow` (line 150-169):

```typescript
function TextSettingRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <SettingRow label={label}>
      <input
        type="text"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (local !== value) onSave(local); }}
        style={{
          width: '100%', fontSize: 12, padding: '4px 8px', borderRadius: 6,
          border: `1px solid ${focused ? '#9ca3af' : '#e5e7eb'}`, outline: 'none', fontFamily: 'inherit',
          boxSizing: 'border-box', transition: 'border-color 0.15s',
        }}
      />
    </SettingRow>
  );
}
```

- [ ] **Step 2: Add focus tracking to `TextAreaSettingRow`**

Update `TextAreaSettingRow` (line 171-193):

```typescript
function TextAreaSettingRow({ label, value, onSave, rows = 2 }: {
  label: string; value: string; onSave: (v: string) => void; rows?: number;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#6b7280' }}>{label}</span>
      <textarea
        value={local}
        onChange={e => setLocal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (local !== value) onSave(local); }}
        rows={rows}
        style={{
          width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6,
          border: `1px solid ${focused ? '#9ca3af' : '#e5e7eb'}`, outline: 'none', fontFamily: 'inherit',
          resize: 'vertical', boxSizing: 'border-box', transition: 'border-color 0.15s',
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add focus tracking to `ColorSettingRow`**

Update `ColorSettingRow` (line 134-148). The color input has no focus indicator either:

```typescript
function ColorSettingRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { setLocal(value); }, [value]);

  return (
    <SettingRow label={label}>
      <input type="color"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); if (local !== value) onSave(local); }}
        style={{ width: 32, height: 26, border: `1px solid ${focused ? '#9ca3af' : '#e5e7eb'}`, borderRadius: 4, cursor: 'pointer', padding: 0, transition: 'border-color 0.15s' }}
      />
    </SettingRow>
  );
}
```

- [ ] **Step 4: Build and verify**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/PersonaSettings.tsx
git commit -m "fix(ui): add visible focus rings to PersonaSettings inputs"
```

- [ ] **Step 6: Invoke `impeccable:polish`**

Run impeccable:polish on `packages/ui/src/components/PersonaSettings.tsx` and `packages/ui/src/components/VoiceSettingsView.tsx` to check alignment and spacing consistency across both settings components.

---

## Task 3: System Prompt — Template Variables + Virtual Civil Servant Tone

**Files:**
- Modify: `packages/server/src/systemPrompt.ts:56-58`
- Modify: `packages/server/src/__tests__/systemPrompt.test.ts`

**Context:** Two changes: (a) The `systemPromptIntro` field in SiteConfig can contain `{name}` and `{siteTitle}` as template variables. Currently (line 58) the intro is inserted as-is. We need to replace these variables before inserting. (b) The TONE section (line 36) should be updated to reflect the "virtual civil servant" persona: professional, courteous, service-oriented.

**IMPORTANT:** Follow the CLAUDE.md process for system prompt changes. The template variable change is mechanical and only needs test coverage. The tone change modifies prompt wording — run baseline compliance test before and after, and get user approval before committing.

- [ ] **Step 1: Write failing tests for template variable replacement**

Add to `packages/server/src/__tests__/systemPrompt.test.ts`:

```typescript
it('replaces {name} in systemPromptIntro with copilotName', () => {
  const config = { ...stubConfig, systemPromptIntro: 'I am {name}, here to help.' };
  const prompt = buildSystemPrompt(config);
  expect(prompt).toContain('I am TestBot, here to help.');
  expect(prompt).not.toContain('{name}');
});

it('replaces {siteTitle} in systemPromptIntro with siteTitle', () => {
  const config = { ...stubConfig, systemPromptIntro: 'Welcome to {siteTitle}.' };
  const prompt = buildSystemPrompt(config);
  expect(prompt).toContain('Welcome to Test Portal.');
  expect(prompt).not.toContain('{siteTitle}');
});

it('replaces both {name} and {siteTitle} in the same intro', () => {
  const config = { ...stubConfig, systemPromptIntro: '{name} assists on {siteTitle}.' };
  const prompt = buildSystemPrompt(config);
  expect(prompt).toContain('TestBot assists on Test Portal.');
});

it('leaves intro unchanged when no template variables present', () => {
  const prompt = buildSystemPrompt(stubConfig);
  expect(prompt).toContain('You help users with tests.');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/packages/server && pnpm test -- --run systemPrompt`
Expected: 3 new tests FAIL (the first three), 1 passes (fourth).

- [ ] **Step 3: Implement template replacement**

In `packages/server/src/systemPrompt.ts`, update line 58:

```typescript
// Replace template variables in systemPromptIntro
const intro = config.systemPromptIntro
  .replace(/\{name\}/g, config.copilotName)
  .replace(/\{siteTitle\}/g, config.siteTitle);
let prompt = `You are ${config.copilotName}, a friendly voice assistant for ${config.siteTitle}. ${intro} Your name is ${config.copilotName}.\n\n`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/packages/server && pnpm test -- --run systemPrompt`
Expected: ALL tests pass, including the 4 new ones.

- [ ] **Step 5: Run full typecheck**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/systemPrompt.ts packages/server/src/__tests__/systemPrompt.test.ts
git commit -m "feat(server): support {name} and {siteTitle} template vars in systemPromptIntro"
```

- [ ] **Step 7: Run baseline compliance test before tone change**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && python3 scripts/test-llm-compliance.py`
Record the baseline score.

- [ ] **Step 8: Update TONE section for virtual civil servant persona**

In `packages/server/src/systemPrompt.ts`, update the TONE line (line 36) from:

```
TONE: Warm, knowledgeable, direct. Jump straight to the answer. Only occasionally use a brief opener like "Sure" — never the same one twice in a row. For "thank you", say "You are welcome" (never "You're welcome").
```

To:

```
TONE: You are a virtual civil servant — professional, courteous, and service-oriented. Be warm, knowledgeable, and direct. Jump straight to the answer. Only occasionally use a brief opener like "Sure" — never the same one twice in a row. For "thank you", say "You are welcome" (never "You're welcome").
```

- [ ] **Step 9: Write test for virtual civil servant tone**

Add to `packages/server/src/__tests__/systemPrompt.test.ts`:

```typescript
it('includes virtual civil servant tone', () => {
  const prompt = buildSystemPrompt(stubConfig);
  expect(prompt).toContain('virtual civil servant');
  expect(prompt).toContain('professional, courteous, and service-oriented');
});
```

- [ ] **Step 10: Run compliance test after tone change + compare**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && python3 scripts/test-llm-compliance.py`
Compare with baseline. If compliance drops, revert the tone change and discuss with user.

- [ ] **Step 11: Run all system prompt tests**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/packages/server && pnpm test -- --run systemPrompt`
Expected: ALL tests pass.

- [ ] **Step 12: Get user approval, then commit**

Show the diff to the user. Only commit after explicit approval:

```bash
git add packages/server/src/systemPrompt.ts packages/server/src/__tests__/systemPrompt.test.ts
git commit -m "feat(server): add virtual civil servant tone to system prompt"
```

---

## Task 4: Mic Toggle Sound Feedback

**Files:**
- Create: `packages/core/src/utils/micSound.ts`
- Modify: `packages/core/src/types/config.ts:38-87`
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:810-852`

**Context:** Play subtle Web Audio tones on mic activate/deactivate. Rising tone (440Hz→660Hz) on start, falling tone (660Hz→440Hz) on stop. ~100ms each. Respects `settings.volume` and `prefers-reduced-motion`. Gated behind `SiteConfig.micSoundEnabled` (default true).

- [ ] **Step 1: Add `micSoundEnabled` to SiteConfig**

In `packages/core/src/types/config.ts`, add after `suggestedPrompts` (line 86):

```typescript
/** Enable mic toggle sound feedback. Default: true. */
micSoundEnabled?: boolean;
```

- [ ] **Step 2: Create `micSound.ts`**

Create `packages/core/src/utils/micSound.ts`:

```typescript
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playTone(startHz: number, endHz: number, volume: number): void {
  if (prefersReducedMotion()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const duration = 0.1;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(startHz, now);
  osc.frequency.linearRampToValueAtTime(endHz, now + duration);

  // Gentle envelope to avoid clicks
  const amp = Math.max(0, Math.min(1, volume)) * 0.15;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(amp, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

/** Rising tone — mic activated */
export function playMicOnSound(volume: number): void {
  playTone(440, 660, volume);
}

/** Falling tone — mic deactivated */
export function playMicOffSound(volume: number): void {
  playTone(660, 440, volume);
}
```

- [ ] **Step 3: Integrate into `useVoiceAgent` start/stop**

In `packages/core/src/hooks/useVoiceAgent.ts`:

Add import at the top:
```typescript
import { playMicOnSound, playMicOffSound } from '../utils/micSound.js';
```

Update `start` callback (line 810-833) — add sound after `setState('LISTENING')`:
```typescript
setState('LISTENING');
vad.start();
if (config.micSoundEnabled !== false) playMicOnSound(settings.volume);
```

Update `stop` callback (line 835-852) — add sound after `setState('IDLE')`:
```typescript
setState('IDLE');
if (config.micSoundEnabled !== false && !force) playMicOffSound(settings.volume);
```

Note: `config` is `useSiteConfig()` — verify it's already available in the hook. `settings` is from `useVoiceSettings()`. The `!force` check avoids playing sound on cleanup/unmount stops.

- [ ] **Step 4: Export from core index**

In `packages/core/src/index.ts`, add:
```typescript
export { playMicOnSound, playMicOffSound } from './utils/micSound';
```

- [ ] **Step 5: Build and typecheck**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build && pnpm typecheck`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/micSound.ts packages/core/src/types/config.ts packages/core/src/hooks/useVoiceAgent.ts packages/core/src/index.ts
git commit -m "feat(core): add mic toggle sound feedback via Web Audio API"
```

- [ ] **Step 7: Invoke `impeccable:delight`**

Run impeccable:delight on the mic sound implementation to evaluate frequency, duration, and gain curve for a pleasant feel. Adjust if needed.

---

## Task 5: Suggested Prompt Chips in Voice Mode

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx:945-1067`

**Context:** When `micPaused === true` AND `messages.length === 0`, show suggestion chips above the ComposerBar. Chips use `config.suggestedPrompts` (same source as `VoiceTranscript`'s empty state, line 821). Tapping sends as text message. Chips disappear after first message or when mic starts.

The chips should go inside ExpandedContent, between the bottom section (tool cards, errors) and the ComposerBar div (line 1065-1067).

- [ ] **Step 1: Add suggestion chips above ComposerBar**

In `GlassCopilotPanel.tsx`, inside `ExpandedContent`, between the existing `</div>` (line 1062) and `<div className="shrink-0">` (line 1065), add:

```tsx
{/* Suggestion chips — shown when mic is paused and no messages yet */}
{micPaused && messages.length === 0 && (() => {
  const prompts = config.suggestedPrompts ?? ['What services are available?', 'Help me with an application'];
  return (
    <div style={{
      padding: '0 16px 4px',
      display: 'flex',
      gap: 8,
      overflowX: 'auto',
      flexShrink: 0,
      WebkitOverflowScrolling: 'touch',
      scrollbarWidth: 'none',
    }}>
      {prompts.map((prompt, i) => (
        <button
          key={i}
          onClick={() => onTextSubmit(prompt)}
          style={{
            flexShrink: 0,
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            color: colors.primary,
            backgroundColor: `${colors.primary}0a`,
            border: `1px solid ${colors.primary}20`,
            borderRadius: 20,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background-color 0.15s',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = `${colors.primary}18`; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = `${colors.primary}0a`; }}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
})()}
```

Note: Line 971 currently destructures only `colors`: `const { colors } = useSiteConfig()`. Change this to `const config = useSiteConfig(); const { colors } = config;` so we can access `config.suggestedPrompts`. `onTextSubmit`, `messages`, and `micPaused` are already props.

- [ ] **Step 2: Hide scrollbar with injected style**

Add to the suggestion chips container a `className` and inject a one-time style rule (same pattern as `ensureSliderStyles` in VoiceSettingsView.tsx). Or simpler: use inline `msOverflowStyle: 'none'` + `scrollbarWidth: 'none'` (already done above) plus a `&::-webkit-scrollbar { display: none }` via a style tag.

Actually, `scrollbarWidth: 'none'` handles Firefox, and for WebKit, add a `className="suggestion-chips"` and inject:
```css
.suggestion-chips::-webkit-scrollbar { display: none }
```

Use the same inject-once pattern as `ensureSliderStyles`.

- [ ] **Step 3: Build and verify**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): show suggested prompt chips above composer when mic is paused"
```

---

## Final Steps

- [ ] **Full build + typecheck**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build && pnpm typecheck
```

- [ ] **Run all tests**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm test
```

- [ ] **Visual verification with Docker**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm docker:kenya
```

Then verify in browser:
1. Open settings → Agent section → edit a field → blur → see "Saved" indicator
2. Tab through PersonaSettings inputs → see focus ring border change
3. Click mic → hear rising tone. Click again → hear falling tone.
4. With mic paused and no messages → see suggestion chips above composer
5. Tap a chip → message sends, chips disappear

- [ ] **Invoke `impeccable:polish`**

Final polish pass on all modified UI files.
