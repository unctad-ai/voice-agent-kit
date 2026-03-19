# Feedback v2: Ticket Numbers & Lifecycle

**Date:** 2026-03-19
**Status:** Specced
**Priority:** Medium
**Extends:** `2026-03-18-conversation-feedback.md` (v1, implemented in kit v5.1.0)

## Problem

Feedback v1 is write-once: users submit, operators read. Two gaps:

1. **No reference handle** — Users can't refer back to their feedback ("I reported something yesterday"). No confirmation beyond a 2-second "Sent" flash. Support conversations require identifying the exact entry by timestamp/content.

2. **No lifecycle** — All feedback sits in the same pile regardless of whether it's been analyzed, is a real bug, has been fixed, or was noise. Operators re-triage the same entries across sessions.

## Feature 1: Ticket Numbers

### Ticket ID Format

```
FB-{4 alphanumeric chars}
```

Examples: `FB-7K3M`, `FB-R2P9`, `FB-A5WX`

Generated server-side from a hash of `timestamp + sessionId + turnNumber`. Deterministic — the same feedback always produces the same ticket ID. 4 uppercase alphanumeric chars = 36^4 = ~1.68M combinations, sufficient for feedback volume.

### Generation Algorithm

```typescript
function generateTicketId(timestamp: number, sessionId: string, turnNumber: number): string {
  const input = `${timestamp}-${sessionId}-${turnNumber}`;
  // Simple non-crypto hash → 4-char alphanumeric
  let hash = 0;
  for (const ch of input) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid ambiguity
  const abs = Math.abs(hash);
  return 'FB-' + Array.from({ length: 4 }, (_, i) =>
    chars[(abs >> (i * 5)) & 31]
  ).join('');
}
```

Character set excludes `0/O/1/I` to avoid visual ambiguity when users read ticket IDs aloud or copy them.

### Server Changes (`feedbackRoutes.ts`)

**POST /api/feedback** — generate `ticketId`, store it in the entry, return it:

```json
// Current response
{ "ok": true }

// New response
{ "ok": true, "ticketId": "FB-7K3M" }
```

**GET /api/feedback** — include `ticketId` in each returned entry.

**GET /api/feedback/:ticketId** — new endpoint, fetch single entry by ticket ID (scan files for matching ticketId field).

**FeedbackEntry type** — add `ticketId: string` field.

**Filename** — change from `{timestamp}-{sessionId}-{turnNumber}.json` to `{ticketId}.json` for direct lookup. The timestamp, sessionId, and turnNumber are already inside the JSON.

### UI Changes

**Confirmation state** (after submit):

Current: Report pill shows `"✓ Sent"` for 2 seconds.

New: Report pill area shows the ticket ID with a copy button for ~4 seconds:

```
┌─────────────────────────┐
│  FB-7K3M  📋            │
└─────────────────────────┘
```

- Ticket ID in amber monospace font (`font-family: monospace`, `color: #92400e`)
- Copy button: small clipboard icon (Lucide `Copy`), on click copies `FB-7K3M` to clipboard and briefly flashes to checkmark (Lucide `Check`)
- Visible for 4 seconds (up from 2s) then returns to normal Report pill
- If user clicks elsewhere or scrolls, confirmation dismisses early

### Files to Modify

| Package | File | Change |
|---------|------|--------|
| server | `src/feedbackRoutes.ts` | Add `generateTicketId()`, include in POST response and stored entry, add `GET /:ticketId` route, rename files to `{ticketId}.json` |
| server | `src/types.ts` | Add `ticketId` to `FeedbackEntry` if type is shared |
| ui | `src/components/GlassCopilotPanel.tsx` | Show ticket ID + copy button in confirmation state |

## Feature 2: Feedback Lifecycle

### Status Model

```
new → triaged → confirmed → fixed
         ↘ dismissed
```

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `new` | Just submitted by user | Auto (on POST) |
| `triaged` | Analyzed, root cause classified | Operator (via triage skill or API) |
| `dismissed` | Not actionable (noise, user error, duplicate) | Operator |
| `confirmed` | Real bug, fix needed | Operator |
| `fixed` | Fix deployed | Operator |

### Stored Fields

Add to `FeedbackEntry`:

```typescript
interface FeedbackEntry {
  // ... existing fields ...
  ticketId: string;
  status: 'new' | 'triaged' | 'dismissed' | 'confirmed' | 'fixed';
  rootCause?: string;        // classification from triage skill
  notes?: string;            // operator notes
  updatedAt?: number;        // last status change timestamp
}
```

Default on creation: `status: 'new'`, no rootCause/notes/updatedAt.

### API Changes

**PATCH /api/feedback/:ticketId** — update status and metadata:

```json
// Request
{
  "status": "triaged",
  "rootCause": "sparse-tool-data",
  "notes": "getServiceDetails handler only returns title+category"
}

// Response
{ "ok": true, "ticketId": "FB-7K3M", "status": "triaged" }
```

Validation:
- `status` must be one of the 5 valid values
- `rootCause` is freeform string (not enum — categories evolve)
- `notes` is freeform string, max 2000 chars
- Sets `updatedAt` to `Date.now()`

**GET /api/feedback** — add `status` query param to filter:

```
GET /api/feedback?status=new        # only untriaged
GET /api/feedback?status=confirmed   # bugs awaiting fix
```

### Triage Skill Integration

The `feedback-triage` skill (voice-agent plugin) should be updated to:

1. After analyzing each entry, call `PATCH /api/feedback/:ticketId` to set `status: 'triaged'` with `rootCause` and `notes`
2. When reporting, include the ticket ID: `### FB-7K3M: "complaint text"`
3. On `GET /api/feedback`, default to `?status=new` so already-triaged entries don't resurface

### Files to Modify

| Package | File | Change |
|---------|------|--------|
| server | `src/feedbackRoutes.ts` | Add PATCH route, status field defaults, status query filter |
| plugin | `skills/feedback-triage/SKILL.md` | Add step to update status after analysis |

## Migration

Existing feedback files (v1 format) have no `ticketId` or `status`. On GET, the server should handle missing fields gracefully:
- Missing `ticketId`: derive from stored timestamp+sessionId+turnNumber using the same hash function (deterministic)
- Missing `status`: default to `'new'`

No file migration needed — fields are populated lazily on read.

## What Stays Unchanged

- Voice pipeline — unaffected
- WebSocket protocol — unaffected
- Trace API — unaffected (traces and feedback remain separate stores, correlated by sessionId)
- Report pill visibility — still always visible, subtle amber styling
- Feedback mode composer — same UX for entering feedback text
