---
name: feedback-triage
description: >
  Use when asked to check user feedback, triage complaints, investigate bad voice agent
  responses, or debug a voice agent conversation. Also triggers on mentions of feedback API,
  user reports, or "what went wrong" in a voice agent deployment.
---

# Voice Agent Feedback Triage

Structured workflow for triaging end-user feedback from voice agent deployments. Correlates feedback entries with session traces to find root causes.

## Prerequisites

Requires a running voice agent deployment with feedback and trace APIs enabled (kit v5.1.0+).

## Step 1: Resolve Site URL

Parse the site argument into a base URL.

| Shorthand | URL |
|-----------|-----|
| `kenya` | `https://kenya.eregistrations.dev` |
| `southafrica` | `https://southafrica.eregistrations.dev` |
| `lesotho` | `https://lesotho.eregistrations.dev` |
| `bhutan` | `https://bhutan.eregistrations.dev` |

If the argument starts with `http` — use as-is. Otherwise map the shorthand. If no argument, ask for one.

## Step 2: Health Check

Verify both endpoints are accessible before proceeding:

```
GET {siteUrl}/api/feedback?limit=1
GET {siteUrl}/api/traces?limit=1
```

Use `WebFetch` for each. If either returns an error or is unreachable, report and stop. Do not proceed with partial data.

## Step 3: Fetch Feedback Entries

```
GET {siteUrl}/api/feedback?status=new&limit={limit}&from={from}&to={to}
```

Use `?status=new` by default to show only untriaged entries. Pass `--status all` to see everything.

Present results as a summary table:

| # | Date | User said | Complaint | Route | Session |
|---|------|-----------|-----------|-------|---------|

If zero entries — report "No feedback found" and stop.

## Step 4: Fetch Session Traces

For each feedback entry, fetch the trace:

```
GET {siteUrl}/api/traces/{sessionId}
```

If trace not found (404), note it — the session may have been cleaned up.

## Step 5: Turn-by-Turn Analysis

Reconstruct the conversation from trace entries. Focus on the turn matching the feedback's `turnNumber`, plus 1-2 turns of context before it.

For each turn, extract:

| Field | Trace stage | What to look for |
|-------|-------------|------------------|
| Route | `turn:start` | `detail` contains `route=...` |
| User speech | `stt:done` | `detail` contains the transcribed text |
| Tools called | `tools` | `detail` shows `round=N toolName(args)` |
| Tool results | `server-tool` / `client-tool` | `detail` shows returned data (may be truncated) |
| Assistant reply | `llm:done` | `detail` contains the response text |
| Timings | all stages | `ms` field for each stage |

**Key questions for the flagged turn:**
1. Did the LLM call the right tool?
2. Did the tool return sufficient data?
3. Does the LLM response accurately reflect the tool result?
4. Did STT correctly capture what the user said?

## Step 6: Classify Root Cause

| Category | Signal in trace | Fix location |
|----------|----------------|-------------|
| **Sparse tool data** | Tool returned partial object (few fields, missing info the page shows) | Client tool handler in consuming project's `registries` setup, or kit's `registries` package |
| **LLM hallucination** | Tool data contains the answer but LLM said otherwise | System prompt rules or temperature (`packages/server/src/systemPrompt.ts`) |
| **LLM skipped tool** | No `tools` entry when a tool call was needed — LLM answered from prior context | System prompt tool-calling rules |
| **STT misrecognition** | `stt:done` text doesn't match user intent from feedback context | STT model config or audio quality |
| **Wrong tool called** | Called `searchServices` when `getServiceDetails` was needed (or similar) | Tool descriptions in `packages/server/src/builtinTools.ts` |
| **Tool error** | Tool stage shows error or empty result | Server tool implementation |
| **TTS failure** | `tts:done` shows error or unexpected provider fallback | TTS provider config or GPU endpoint |
| **Latency** | High `ms` values causing poor UX | Provider scaling or infrastructure |

## Step 7: Report

For each feedback entry, report:

```
### {ticketId}: "{complaint text}"
**Turn {t}** on route `{route}`
**User said:** "{stt transcription}"
**Tool called:** {toolName} → returned {summary of result}
**Pesa replied:** "{llm response}"

**Root cause:** {category} — {one-line explanation}
**Fix location:** {file path or component}
**Severity:** {high|medium|low} — {impact description}
```

## Step 8: Update Status

After analyzing each entry, update its status via the PATCH API:

```
PATCH {siteUrl}/api/feedback/{ticketId}
Content-Type: application/json

{
  "status": "triaged",
  "rootCause": "{category from Step 6}",
  "notes": "{one-line summary of diagnosis}"
}
```

Use `WebFetch` with method PATCH. This prevents re-triaging the same entry in future runs.

## Common Patterns

**"Tool returned only title+category"** → The `getServiceDetails` client tool handler only reads minimal DOM data. The handler in the consuming project needs to extract more fields (duration, requirements, costs, documents).

**"LLM didn't call tool on follow-up"** → When the LLM already has a (sparse) tool result in context, it may skip re-querying. This is a system prompt issue — the prompt should instruct the LLM to re-query when the user asks about specific fields not in the previous result.

**"STT heard gibberish"** → Check `stt:raw-done` duration. Very short audio (<500ms) or very long silence (>30s) often produces phantom transcriptions. The `stt:filtered` stage means VAD rejected it — this is working correctly.
