# Conversation Feedback

**Date:** 2026-03-18
**Status:** Specced
**Priority:** Medium — actionable user feedback for conversation quality

## Problem

No way for end users to report bad assistant responses. Debugging requires SSH + grep through server logs. Users experience issues (wrong service, hallucinated routes, unhelpful answers) but have no channel to report them in context.

## UX Flow

### 1. Report pill on assistant messages

After each assistant message in the transcript, show a small `▶ Report` pill. Styling: `font-size:11px`, amber text (`#92400e`), light amber background, rounded pill. Always visible (no auto-hide) but visually subtle.

### 2. Feedback mode composer

Tapping the Report pill enters **feedback mode**. The composer bar switches from voice/text mode to feedback mode:

- **Flag icon** (left): Solid amber circle (`#d97706`) with white Lucide `Flag` icon. Visual indicator only, not interactive.
- **Input** (center): Amber border (`2px solid #d97706`), light amber fill. Placeholder: "What went wrong?"
- **Send** (right): Amber circle with arrow-up icon. Only appears when text is entered.
- **Cancel** (right): Gray circle with X icon. Always visible. Exits feedback mode without submitting.

### 3. Submit feedback

Pressing send submits `POST /api/feedback` with the payload below, clears the input, exits feedback mode, and shows a brief confirmation (e.g. the Report pill text changes to "✓ Sent" for 2s).

### 4. Cancel

Pressing the ✕ button exits feedback mode and returns to normal voice/text composer. No data is sent.

## Feedback Payload

```json
{
  "sessionId": "2e23152c",
  "turnNumber": 3,
  "text": "Wrong service, I asked for VAT not PIN",
  "assistantMessage": "The closest service is Tax registration...",
  "userMessage": "I want VAT registration",
  "toolCalls": ["searchServices"],
  "timings": { "stt_ms": 72, "llm_ms": 2035, "tts_ms": 424 },
  "route": "/",
  "copilotName": "Pesa",
  "userAgent": "Mozilla/5.0..."
}
```

## API

### POST /api/feedback

Accepts the payload above. Stores as a JSON file in `data/feedback/` (same volume as persona data). Filename: `{timestamp}-{sessionId}-{turnNumber}.json`. Returns `201`.

### GET /api/feedback

Query parameters:
- `sessionId` — filter by session
- `copilotName` — filter by deployment
- `from` / `to` — date range (ISO 8601)
- `limit` — max results (default 50)

Returns array of feedback entries, newest first.

## Files to Modify

### Server (packages/server)
- Create: `src/feedbackRoutes.ts` — Express router for `POST /api/feedback` and `GET /api/feedback`
- Modify: `src/index.ts` — mount feedback routes at `/api/feedback`

### UI (packages/ui)
- Modify: `src/components/VoiceTranscript.tsx` — add Report pill after assistant messages
- Modify: `src/components/GlassCopilotPanel.tsx` — add feedback mode to ComposerBar

### Core (packages/core)
- Modify: `src/hooks/useVoiceAgent.ts` — expose session ID and turn data needed for feedback payload

## What stays unchanged

- Voice pipeline — feedback is a side channel, doesn't affect conversation flow
- WebSocket protocol — feedback uses HTTP, not WS
- Server logs — feedback is complementary, not a replacement
