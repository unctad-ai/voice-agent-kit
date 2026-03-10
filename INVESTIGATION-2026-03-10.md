# Voice Agent Form-Filling Investigation — 2026-03-10

## Test Environment
- **URL:** https://agent.govbridge.org
- **Backend:** `kenya-agent-backend-1` (Docker on `bridge` server)
- **Frontend:** `kenya-agent-frontend-1` (Docker, Vite SPA)
- **Kit version:** v0.1.4 (commit `a67b3dd`)

## Test Scenario
1. Homepage → ask agent to navigate to "Evaluate your investment journey"
2. Ask agent to help apply → should redirect to `/dashboard/evaluate-investment`
3. Ask agent to assist in filling the form step by step

## Results

### Steps 1-3: PASS
- Agent correctly searched services, navigated to the service page, and described it.
- On "I'd like to apply", agent called `startApplication` and navigated to `/dashboard/evaluate-investment`.
- URL confirmed: `https://agent.govbridge.org/dashboard/evaluate-investment`

### Step 4: FAIL — Agent gets stuck after first form fill

**What happened:**
1. User: "Yes please help me fill this form. I am the director of the company."
2. Agent called `getFormSchema` → received form sections
3. Agent called `fillFormFields` → set `capacity` to `director` (radio button correctly selected)
4. Agent called `getFormSchema` again (to see newly visible fields after the fill)
5. **STUCK** — "Processing..." spinner forever, no further interaction possible

**Form state after stuck:**
- "Director of the company" radio selected ✓
- "What type of company do you want to create?" appeared (Private limited / Branch of foreign) — agent never saw this
- Agent panel shows: `Reading form · {...} → Form fill · Capacity → Reading form → Processing...`

**Server logs (nginx reverse proxy):**
```
09:40:02 POST /api/chat → 4207 bytes  (user message)
09:40:02 POST /api/chat → 3788 bytes  (auto follow-up #1)
09:40:03 POST /api/chat → 1921 bytes  (auto follow-up #2)
-- NO MORE REQUESTS --
```

Three requests were sent, but the agent needed at least one more to continue. The client stopped sending.

## Root Cause: Double-Increment in roundTripCountRef

**File:** `packages/core/src/hooks/useVoiceAgent.ts`

The `roundTripCountRef` counter (max = 3) is incremented in **two places per round-trip**:

1. **`onToolCall` (line 573):** `roundTripCountRef.current++` — increments when the client tool handler fires
2. **`sendAutomaticallyWhen` (line 416):** `roundTripCountRef.current++` — increments when the auto follow-up triggers

### Counter trace for the form-fill flow:

| Event | Increment Location | Count After | Blocked? |
|-------|-------------------|-------------|----------|
| `getFormSchema` tool call arrives | `onToolCall` | 1 | No |
| Auto-send follow-up #1 | `sendAutomaticallyWhen` | 2 | No |
| `fillFormFields` tool call arrives | `onToolCall` | 3 | No |
| Auto-send follow-up #2 | `sendAutomaticallyWhen` | 4 | No (check is `> 3`, 3 was the value when checked) |
| `getFormSchema` tool call arrives | `onToolCall` | 5 | **YES — 5 > 3, return early** |

The tool handler returns without executing `handleClientTool` or calling `addToolOutput`. The message never completes, `sendAutomaticallyWhen` never fires, and the agent is permanently stuck at "Processing..."

### Why this is especially bad for form filling:

The system prompt (line 26 of `systemPrompt.ts`) instructs the LLM:
> "Call getFormSchema again after every fillFormFields to see newly visible fields. NEVER say a form is complete or suggest submitting without calling getFormSchema first."

The required pattern per form section is:
```
getFormSchema → fillFormFields → getFormSchema (verify) → [ask user] → fillFormFields → getFormSchema ...
```

With double-counting, **the budget is exhausted after exactly ONE fill+verify cycle** (5 increments used out of a max of 3). Multi-step form filling is impossible.

### The counter only resets on new user messages

`roundTripCountRef.current = 0` happens in:
- `voiceUserMessagePipeline` (line 760) — when user speaks
- `startListening` callback (line 761)
- Session reset (line 1062)

It does **not** reset on typed messages through `useChat` unless the SDK internally calls the right callback. Even if it did, the user shouldn't need to manually intervene between every field — the agent is supposed to guide through multiple steps per turn.

## Additional Observations

### Mismatch: Agent description vs actual form
- Agent said: "Please provide the basic details about your investment sector and location"
- Actual form shows: "In what capacity are you submitting this application?" (radio buttons)
- The agent hallucinated the form content before calling `getFormSchema`

### UI shows stale "Processing..." with no timeout
- No timeout or recovery mechanism when the round-trip limit is hit silently
- User has no indication of what went wrong — just an eternal spinner
- `console.warn` fires but is invisible to the user

## Recommended Fixes

### Fix 1: Remove double-counting (Critical)
The counter should increment in **one** place only. Since `sendAutomaticallyWhen` represents the actual round-trip (request sent to server), increment only there:

```typescript
// onToolCall — REMOVE the increment
// roundTripCountRef.current++;  // DELETE THIS LINE
if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) {
  console.warn(`[VoiceAgent] Client round-trip limit reached`);
  return;
}
```

### Fix 2: Increase MAX_CLIENT_ROUND_TRIPS
Even with single-counting, 3 is too low for multi-step forms. A form with 3 sections needs at minimum: `getFormSchema → fill → getFormSchema → fill → getFormSchema → fill → getFormSchema` = 7 round-trips. Recommend **8-10**.

### Fix 3: Add user-visible feedback on limit reached
Instead of silently failing, surface the limit to the user:
```typescript
if (roundTripCountRef.current > MAX_CLIENT_ROUND_TRIPS) {
  // Add a visible message instead of just console.warn
  setMessages(prev => [...prev, {
    role: 'assistant',
    content: 'I reached my step limit for this turn. Please tell me what to do next and I will continue.',
  }]);
  return;
}
```

### Fix 4: Reset counter on typed messages too
Ensure `roundTripCountRef` resets when the user types a message (not just voice), so the user can at least manually unblock the flow.

## Session Artifacts

All browser captures saved to:
```
/Users/moulaymehdi/Library/Caches/superpowers/browser/2026-03-10/session-1773134694033/
```

Key screenshots:
- `001-navigate.png` — Homepage
- `013-type-after.png` — Agent navigated to service page
- `018-type-after.png` — Agent navigated to dashboard form
- `021-type-after.png` — Form filled "Director" but agent stuck on "Processing..."
