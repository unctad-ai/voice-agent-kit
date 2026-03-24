# Transcript Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add message bubbles with tinting, an empty state with suggested prompts, and a collapsed bar message preview.

**Architecture:** Modify `VoiceTranscript.tsx` for bubbles and empty state, `GlassCopilotPanel.tsx` for collapsed bar snippet, and `config.ts` for the new `suggestedPrompts` field. All changes are in the UI and core packages.

**Tech Stack:** React, motion/react, useSiteConfig

**Spec:** `docs/superpowers/specs/2026-03-24-transcript-polish-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/core/src/types/config.ts` | Modify | Add `suggestedPrompts` to SiteConfig |
| `packages/ui/src/components/VoiceTranscript.tsx` | Modify | Assistant message bubbles, revamped empty state with chips |
| `packages/ui/src/components/GlassCopilotPanel.tsx` | Modify | Pass messages to CollapsedBar, show last-message snippet |

---

### Task 1: Add `suggestedPrompts` to SiteConfig

**Files:**
- Modify: `packages/core/src/types/config.ts:83`

- [ ] **Step 1: Add the field**

After the `excludeRoutes` field (line 83), add:

```typescript
  /** Suggested prompts shown in empty transcript state. Tappable chips. */
  suggestedPrompts?: string[];
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: pass

- [ ] **Step 3: Commit**

```
git add packages/core/src/types/config.ts
git commit -m "feat(core): add suggestedPrompts to SiteConfig"
```

---

### Task 2: Assistant message bubbles

**Files:**
- Modify: `packages/ui/src/components/VoiceTranscript.tsx:527-563` (panel message rendering)

Currently assistant messages have no background — just text. User messages already have a bubble (`backgroundColor: 'rgba(219,33,41,0.07)'`). Add a matching bubble for assistant messages using `colors.primary`.

Note: `VoiceMessage` (defined in `packages/core/src/types/voice.ts`) uses `.text: string` — not Vercel AI SDK's `UIMessage`.

- [ ] **Step 1: Read `colors` from config**

The component already has `const config = useSiteConfig()` at line 357. Extract colors:

At line 359, after `const assistantLabel = ...`, add:

```typescript
const { colors } = config;
```

- [ ] **Step 2: Add assistant bubble styling**

Replace the assistant message div (lines 527-538). Currently assistant messages have an empty style object `{}` while user messages have the bubble. Change to:

```tsx
// Replace lines 527-538:
                  <div
                    style={{
                      ...(isAI
                        ? {
                            backgroundColor: `${colors.primary}0D`,
                            borderRadius: '14px 14px 14px 4px',
                            padding: '10px 14px',
                            maxWidth: '85%',
                          }
                        : {
                            backgroundColor: 'rgba(0,0,0,0.04)',
                            borderRadius: '14px 14px 4px 14px',
                            padding: '10px 14px',
                            maxWidth: '85%',
                          }),
                    }}
                  >
```

Key changes:
- Assistant: primary color at `0D` (~5% opacity), bottom-left tight corner
- User: neutral gray `rgba(0,0,0,0.04)` instead of hardcoded red, no border — works with any brand color
- Both get `maxWidth: '85%'` and consistent padding/radius

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: pass

- [ ] **Step 4: Commit**

```
git add packages/ui/src/components/VoiceTranscript.tsx
git commit -m "feat(ui): add message bubbles for assistant and user messages"
```

---

### Task 3: Revamp empty state with suggested prompts

**Files:**
- Modify: `packages/ui/src/components/VoiceTranscript.tsx:802-911` (EmptyStateGraphic)

The empty state currently shows "How can I help?" with "Start talking" / "Type a message" buttons. Replace with: greeting message from config + suggested prompt chips.

- [ ] **Step 1: Add `onTextSubmit` prop to VoiceTranscript**

Add to `VoiceTranscriptProps` (line 79):

```typescript
  /** Callback to submit a text message (for suggested prompt chips) */
  onTextSubmit?: (text: string) => void;
```

Pass it through to `EmptyStateGraphic` alongside the existing props.

- [ ] **Step 2: Rewrite EmptyStateGraphic**

Replace the `EmptyStateGraphic` function (lines 802-911). Add `AgentAvatar` import at top of file if not already imported (it is — line 35).

```tsx
function EmptyStateGraphic({ primaryColor, voiceState, onStartMic, onSwitchToKeyboard, onTextSubmit, portraitSrc }: {
  primaryColor: string;
  voiceState?: string;
  onStartMic?: () => void;
  onSwitchToKeyboard?: () => void;
  onTextSubmit?: (text: string) => void;
  portraitSrc?: string;
}) {
  const config = useSiteConfig();
  const isListening = voiceState === 'LISTENING' || voiceState === 'USER_SPEAKING';
  const greeting = config.greetingMessage || 'How can I help you today?';
  const prompts = config.suggestedPrompts ?? ['What services are available?', 'Help me with an application'];

  if (isListening) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingTop: 60,
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 500, color: primaryColor, margin: 0, opacity: 0.7 }}>
          I'm listening...
        </p>
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)', margin: 0 }}>
          Go ahead, I can hear you
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        paddingTop: 48,
      }}
    >
      <AgentAvatar state="idle" getAmplitude={() => 0} size={64} portraitSrc={portraitSrc} />

      <p style={{ fontSize: 17, fontWeight: 500, color: primaryColor, margin: 0, opacity: 0.6, textAlign: 'center', lineHeight: 1.4 }}>
        {greeting}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 320 }}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onTextSubmit?.(prompt)}
            style={{
              padding: '8px 16px',
              borderRadius: 18,
              border: '1px solid rgba(0,0,0,0.1)',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              color: 'rgba(0,0,0,0.55)',
              transition: 'background-color 0.15s, border-color 0.15s',
              lineHeight: 1.3,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = `${primaryColor}0A`;
              e.currentTarget.style.borderColor = `${primaryColor}33`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
        {onStartMic && (
          <button
            onClick={onStartMic}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 16,
              border: 'none',
              backgroundColor: `${primaryColor}0A`,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
              color: 'rgba(0,0,0,0.4)',
            }}
          >
            <Mic style={{ width: 12, height: 12, opacity: 0.5 }} />
            or speak
          </button>
        )}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 3: Wire `onTextSubmit` through**

In the panel variant empty state rendering (line 646), pass `onTextSubmit`:

```tsx
// Line 646 — add onTextSubmit to EmptyStateGraphic:
<EmptyStateGraphic primaryColor={config.colors.primary} onTextSubmit={/* need to pass from props */} />
```

The `VoiceTranscript` component needs `onTextSubmit` wired from `GlassCopilotPanel.tsx`. In `ExpandedContent` where `VoiceTranscript` is rendered (around line 1023), `onTextSubmit` is available as a prop of `ExpandedContent`. Add it to the `VoiceTranscript` call:

In `VoiceTranscript` call site (GlassCopilotPanel.tsx ~line 1023):
```tsx
<VoiceTranscript messages={messages} isTyping={isTyping} variant="panel" voiceError={voiceError} voiceState={voiceState} onStartMic={onStartMic} onSwitchToKeyboard={onSwitchToKeyboard} onReport={onReport} feedbackSentTurns={feedbackSentTurns} onTextSubmit={onTextSubmit} />
```

In `VoiceTranscript`, pass to `EmptyStateGraphic`:
```tsx
// Panel empty state (~line 646):
<EmptyStateGraphic primaryColor={config.colors.primary} onTextSubmit={onTextSubmit} portraitSrc={/* pass portraitSrc from VoiceTranscript props — add to VoiceTranscriptProps too */} />

// Overlay empty state (~line 780):
<EmptyStateGraphic primaryColor={config.colors.primary} voiceState={voiceState} onStartMic={onStartMic} onSwitchToKeyboard={onSwitchToKeyboard} onTextSubmit={onTextSubmit} portraitSrc={portraitSrc} />

// Also add to VoiceTranscriptProps:
  portraitSrc?: string;

// And pass from GlassCopilotPanel VoiceTranscript call site:
portraitSrc={portraitSrc}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```
git add packages/ui/src/components/VoiceTranscript.tsx packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): revamp empty state with greeting and suggested prompt chips"
```

---

### Task 4: Collapsed bar last-message snippet

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx` (CollapsedBar)

- [ ] **Step 1: Add `lastMessage` prop to CollapsedBar**

Add to the props type (~line 356):

```typescript
  /** Last assistant message text for preview in subtitle */
  lastMessage?: string;
```

- [ ] **Step 1b: Also fix collapsed bar "Paused" label**

The collapsed bar subtitle at line 470 still says `'Paused'` (the batch 1 replace_all missed this multi-line ternary). Change it to `'Tap mic to resume'`.

- [ ] **Step 2: Update subtitle logic**

In the collapsed bar subtitle section (line 469-473), the ternary currently reads:

```tsx
) : micPaused ? (
            'Tap mic to resume'   // ← fixed in step 1b
          ) : (
            STATE_LABELS[voiceState]
```

Replace the whole `micPaused` branch with:

```tsx
) : (micPaused || voiceState === 'IDLE') && lastMessage ? (
            lastMessage.length > 40 ? lastMessage.slice(0, 40).trimEnd() + '...' : lastMessage
          ) : micPaused ? (
            'Tap mic to resume'
          ) : (
            STATE_LABELS[voiceState]
```

This shows the last message when paused/idle AND a message exists. Falls back to "Tap mic to resume" when paused without messages, or state label otherwise.

- [ ] **Step 3: Pass `lastMessage` from WiredPanel**

In the CollapsedBar render site (~line 1342), compute and pass the last assistant message:

```tsx
const lastAssistantMsg = messages.slice().reverse().find(m => m.role === 'assistant')?.text;
```

Add to the CollapsedBar props:
```tsx
lastMessage={lastAssistantMsg}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```
git add packages/ui/src/components/GlassCopilotPanel.tsx
git commit -m "feat(ui): show last message snippet in collapsed bar"
```

---

### Task 5: Visual verification

- [ ] **Step 1: Build and start Kenya**

Run: `pnpm build && pnpm docker:kenya`

- [ ] **Step 2: Verify message bubbles**

Open http://localhost:3000, navigate to a service page, open the panel, have a conversation. User messages should have gray bubbles (right-aligned, tight bottom-right corner). Assistant messages should have faint primary-tinted bubbles (left-aligned, tight bottom-left corner).

- [ ] **Step 3: Verify empty state with chips**

Open panel fresh (incognito). Should show greeting message + suggestion chips. Click a chip — it should submit as a text message.

- [ ] **Step 4: Verify collapsed bar snippet**

After a conversation, collapse the panel. Subtitle should show a truncated preview of the last assistant message. Tap mic to pause — should keep showing the snippet. Close and reopen — empty state should return.

- [ ] **Step 5: Commit if tweaks needed**

```
git add -A && git commit -m "fix(ui): transcript polish visual adjustments"
```

---

### Task 6: Release

- [ ] **Step 1: Add Swkenya suggestedPrompts**

In `/Users/moulaymehdi/PROJECTS/figma/Swkenya/src/voice-config.ts`, add to siteConfig:

```typescript
suggestedPrompts: [
  'How do I register a company?',
  'What permits do I need?',
  'Check my application status',
],
```

Commit and push Swkenya.

- [ ] **Step 2: Create changeset and release kit**

Create `.changeset/transcript-polish.md`:

```markdown
---
'@unctad-ai/voice-agent-core': patch
'@unctad-ai/voice-agent-ui': patch
---

Message bubbles with tinting, empty state with suggested prompt chips, collapsed bar message preview.
```

```
git add .changeset/transcript-polish.md && git commit -m "chore: add changeset for transcript polish"
./scripts/release.sh --yes
```
