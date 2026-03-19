# Feedback Triage Skill

**Date:** 2026-03-19
**Status:** Specced
**Type:** Technique skill (voice-agent plugin, unctad-digital-government marketplace)

## Problem

User feedback is collected via `POST /api/feedback` and session traces via `GET /api/traces/:sessionId`, but triaging feedback requires manually correlating entries with traces, reconstructing conversations turn-by-turn, and classifying root causes. This is tedious and error-prone without a structured process.

## Skill Purpose

Codify the feedback-to-root-cause debugging workflow:
1. Fetch feedback from a deployment
2. Correlate with session traces
3. Analyze turn-by-turn to find where the conversation went wrong
4. Classify the root cause into an actionable category

## Plugin Location

`unctad-digital-government` marketplace → `plugins/voice-agent/`

```
plugins/voice-agent/
├── .claude-plugin/plugin.json
├── commands/feedback-triage.md       # /feedback-triage kenya
├── skills/feedback-triage/SKILL.md   # Auto-trigger + full workflow
└── README.md
```

## Workflow

### Step 1: Resolve Site URL

Accept deployment shorthand or full URL:

| Shorthand | URL |
|-----------|-----|
| `kenya` | `https://kenya.eregistrations.dev` |
| `southafrica` | `https://southafrica.eregistrations.dev` |
| `lesotho` | `https://lesotho.eregistrations.dev` |
| `bhutan` | `https://bhutan.eregistrations.dev` |
| Any URL | Used as-is |

### Step 2: Health Check

Verify both endpoints respond before proceeding:
- `GET {siteUrl}/api/feedback?limit=1`
- `GET {siteUrl}/api/traces?limit=1`

If either fails → report error and stop.

### Step 3: Fetch Feedback

`GET {siteUrl}/api/feedback` with optional query params (limit, from, to, copilotName).

Present summary table:
| # | Date | User said | Complaint | Session ID |
|---|------|-----------|-----------|------------|

### Step 4: Fetch Traces

For each feedback entry with a `sessionId`, fetch `GET {siteUrl}/api/traces/{sessionId}`.

### Step 5: Turn-by-Turn Analysis

Reconstruct conversation timeline from trace entries:
- `turn:start` → route context
- `stt:done` → what user said
- `tools` → which tools were called
- `server-tool` / `client-tool` → what data was returned
- `llm:done` → what the assistant replied
- `tts:done` → TTS provider and timing

Focus on the turn matching the feedback's `turnNumber`.

### Step 6: Classify Root Cause

| Category | Signal in trace | Fix location |
|----------|----------------|-------------|
| **Sparse tool data** | Tool returned partial data (missing fields the page shows) | Client tool handler in consuming project or registries package |
| **LLM hallucination** | Tool returned correct data but LLM stated otherwise | System prompt or temperature tuning |
| **LLM skipped tool** | No tool call when one was needed (answered from memory) | System prompt tool-calling rules |
| **STT misrecognition** | `stt:done` text doesn't match user intent | STT model, threshold, or language config |
| **TTS failure** | `tts:done` errored or provider=fallback | TTS provider config or GPU endpoint |
| **Tool error** | Tool threw error or returned error object | Server tool implementation |
| **Wrong tool called** | Different tool than expected for the query | Tool descriptions in builtinTools.ts |
| **Slow response** | High `ms` values on any stage | Provider performance or infrastructure |

### Step 7: Report

Per-entry diagnosis:
- What happened (turn timeline)
- Root cause category
- Specific fix location (file + what to change)
- Severity (user-facing impact)

## APIs Used

- `GET /api/feedback` — query params: sessionId, copilotName, from, to, limit
- `GET /api/traces/:sessionId` — full session trace with entries array
- `GET /api/traces` — list recent sessions (metadata only)

## What This Skill Does NOT Do

- Does not fix the bugs (reports them for manual or automated fixing)
- Does not modify any deployment
- Read-only: only fetches data via GET endpoints
