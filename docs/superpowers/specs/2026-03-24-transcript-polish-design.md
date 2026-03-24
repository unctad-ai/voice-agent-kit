# Batch 2: Transcript Polish

## Summary

Improve the panel interior — message bubbles, empty state with suggested prompts, and collapsed bar message preview. These changes make the conversation feel alive and the empty state inviting.

## Changes

### 1. Message bubbles with tinting

Currently messages in `VoiceTranscript` are flat text with no visual distinction between user and assistant. Add subtle background tinting:

- **Assistant messages**: `colors.primary` at 5% opacity, left-aligned, rounded bubble
- **User messages**: `rgba(0,0,0,0.04)`, right-aligned, rounded bubble
- Bubble padding: `10px 14px`, border-radius: `16px` (with `4px` on the aligned corner)
- Max width: 85% of transcript area
- Font size stays at 14px, line-height 1.5

**Files:**
- Modify: `packages/ui/src/components/VoiceTranscript.tsx`

### 2. Empty state welcome + suggested prompts

When the transcript is empty and the panel is expanded, show:

- Agent avatar (reuse `AgentAvatar` at size 64)
- Greeting: `greetingMessage` from SiteConfig (fallback: "How can I help you today?")
- 2-3 tappable suggestion chips below the greeting

**Suggestion chips:**
- Sourced from a new optional `SiteConfig.suggestedPrompts?: string[]`
- Default if not provided: `["What services are available?", "Help me with an application"]`
- Styled as pills: `border: 1px solid rgba(0,0,0,0.1)`, `border-radius: 18px`, `padding: 8px 16px`, `font-size: 13px`
- On tap: insert the text as a user message (call `onTextSubmit`)
- Centered vertically in the transcript area with subtle entrance animation

**Files:**
- Modify: `packages/ui/src/components/VoiceTranscript.tsx` (empty state rendering)
- Modify: `packages/core/src/types/config.ts` (add `suggestedPrompts`)

### 3. Collapsed bar last-message snippet

The collapsed bar currently shows `STATE_LABELS[voiceState]` as the subtitle. When there's a conversation history, show a truncated preview of the last assistant message instead.

- Max 40 characters, truncated with ellipsis
- Falls back to state label when no messages or during active states (LISTENING, PROCESSING, AI_SPEAKING)
- Only show message preview when `micPaused` or `IDLE`

**Files:**
- Modify: `packages/ui/src/components/GlassCopilotPanel.tsx` (CollapsedBar subtitle logic)

## Not in scope

- Message timestamps
- Message grouping/threading
- Read receipts or delivery indicators
- Markdown rendering in messages
