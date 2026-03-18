# Offline UX Improvements

**Date:** 2026-03-18
**Status:** Specced
**Priority:** Low — polish, not blocking

## Problem

When the voice agent backend is offline, the UI has inconsistencies:

1. **FAB shows green ring** (ready state) even when backend is unreachable — misleads users into thinking the assistant is available
2. **Text input stays enabled** when offline — user can type but nothing happens
3. **No auto-retry** — requires manual "Retry connection" click

## Changes

### 1. FAB ring → gray when offline
- File: `packages/ui/src/components/GlassCopilotPanel.tsx` (FAB section)
- When connection state is `offline` or `error`, render the orb ring in gray instead of the primary color
- Optional: add a small red dot badge on the FAB corner

### 2. Disable text input when offline
- File: `packages/ui/src/components/GlassCopilotPanel.tsx` (input section)
- When offline: `disabled={true}`, placeholder → "Reconnecting..."
- Hide send button or gray it out

### 3. Auto-retry with exponential backoff
- File: `packages/core/src/hooks/useVoiceWebSocket.ts` or `useVoiceAgent.ts`
- On disconnect: auto-retry at 3s, 6s, 12s, 24s, then cap at 30s
- Show "Retrying in Ns..." on the retry button instead of static "Retry connection"
- Manual click resets the backoff and retries immediately

## Testing

- Kill the backend server, verify FAB turns gray
- Verify text input is disabled
- Verify auto-retry kicks in and succeeds when backend comes back
- Verify manual retry button still works
