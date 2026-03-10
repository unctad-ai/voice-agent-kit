# Fix Client Tool Round-Trip Counter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the double-increment bug in `roundTripCountRef` that prevents the voice agent from filling multi-step forms, and add user-visible feedback when the limit is reached.

**Architecture:** The round-trip counter in `useVoiceAgent.ts` currently increments in two places per tool call (`onToolCall` + `sendAutomaticallyWhen`), exhausting the budget of 3 after just one fill cycle. The fix removes the `onToolCall` increment (keeping only the `sendAutomaticallyWhen` one which represents actual round-trips), raises the limit to 10, and adds a visible fallback message when the limit is hit instead of silently freezing.

**Tech Stack:** React hooks (TypeScript), `@ai-sdk/react` useChat, pnpm monorepo

**Reference:** See `INVESTIGATION-2026-03-10.md` at repo root for the full bug analysis with server logs, counter traces, and screenshots.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/hooks/useVoiceAgent.ts` | Modify (lines 331-333, 400-421, 569-577) | Fix counter logic, raise limit, add fallback |

This is a single-file fix. All changes are in the `useVoiceAgent` hook.

---

## Chunk 1: Fix Round-Trip Counter

### Task 1: Remove double-increment in onToolCall

The counter currently increments in two places per tool call. Only `sendAutomaticallyWhen` should increment, since it represents actual HTTP requests being sent.

**Files:**
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:573-577`

- [ ] **Step 1: Read the current code to confirm the exact lines**

Run: Read file at `packages/core/src/hooks/useVoiceAgent.ts` lines 565-640

Confirm you see this block at lines 573-577:
```typescript
      roundTripCountRef.current++;
      if (roundTripCountRef.current > MAX_CLIENT_ROUND_TRIPS) {
        console.warn(`[VoiceAgent] Client round-trip limit reached`);
        return;
      }
```

- [ ] **Step 2: Remove the increment, keep the guard check**

In `packages/core/src/hooks/useVoiceAgent.ts`, replace lines 573-577:

```typescript
      roundTripCountRef.current++;
      if (roundTripCountRef.current > MAX_CLIENT_ROUND_TRIPS) {
        console.warn(`[VoiceAgent] Client round-trip limit reached`);
        return;
      }
```

With:

```typescript
      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) {
        console.warn(
          `[VoiceAgent] Client round-trip limit reached (${roundTripCountRef.current}/${MAX_CLIENT_ROUND_TRIPS})`
        );
        return;
      }
```

Key changes:
- **Removed** `roundTripCountRef.current++` — counting happens only in `sendAutomaticallyWhen`
- **Changed** `>` to `>=` — since we no longer pre-increment, use `>=` to maintain the same threshold semantics
- **Improved** the warn message to include the actual count for debugging

- [ ] **Step 3: Verify the build passes**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`

Expected: No type errors (this is a pure logic change, no type signatures affected).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useVoiceAgent.ts
git commit -m "fix(core): remove double-increment in client tool round-trip counter

The roundTripCountRef was incrementing in both onToolCall and
sendAutomaticallyWhen, causing each tool call to cost 2 against
a limit of 3. This exhausted the budget after one fill+verify
cycle (getFormSchema -> fillFormFields -> getFormSchema = 5 increments).

Now counting only in sendAutomaticallyWhen which represents actual
HTTP round-trips sent to the server."
```

---

### Task 2: Align sendAutomaticallyWhen guard to use >=

The `sendAutomaticallyWhen` guard at line 401 uses `>` (`roundTripCountRef.current > MAX`). After Task 3 adds a synthetic `chatAddToolOutput` when the limit is reached, that output would trigger `sendAutomaticallyWhen` — and since `count == MAX` passes the `>` check, it would fire one more request past the limit. Both guards must use `>=` for consistency.

**Files:**
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:401`

- [ ] **Step 1: Read line 401 to confirm**

Run: Read file at `packages/core/src/hooks/useVoiceAgent.ts` lines 398-422

Confirm you see at line 401:
```typescript
      if (roundTripCountRef.current > MAX_CLIENT_ROUND_TRIPS) return false;
```

- [ ] **Step 2: Change `>` to `>=`**

In `packages/core/src/hooks/useVoiceAgent.ts`, replace:

```typescript
      if (roundTripCountRef.current > MAX_CLIENT_ROUND_TRIPS) return false;
```

With:

```typescript
      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) return false;
```

This ensures that when `onToolCall` provides a synthetic tool output at the limit, `sendAutomaticallyWhen` will NOT send yet another follow-up request.

- [ ] **Step 3: Verify the build passes**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useVoiceAgent.ts
git commit -m "fix(core): align sendAutomaticallyWhen guard to use >= for round-trip limit

Ensures the auto-send guard is consistent with the onToolCall guard.
Without this, a synthetic tool output at the limit boundary would
still trigger one extra request."
```

---

### Task 3: Raise MAX_CLIENT_ROUND_TRIPS from 3 to 10

> **Note:** Investigation Fix 4 ("reset counter on typed messages") is already implemented at line 1118 of `useVoiceAgent.ts` — the `sendTextMessage` callback resets `roundTripCountRef.current = 0`. No change needed.

Multi-step forms need many round-trips. The system prompt requires `getFormSchema` after every `fillFormFields`. A form with 3 sections needs at minimum 7 round-trips: `(getFormSchema -> fillFormFields) x 3 + final getFormSchema`. With a limit of 3, even with single-counting, only 3 auto-sends are allowed.

**Files:**
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:333`

- [ ] **Step 1: Read line 333 to confirm**

Run: Read file at `packages/core/src/hooks/useVoiceAgent.ts` lines 330-335

Confirm you see:
```typescript
  const MAX_CLIENT_ROUND_TRIPS = 3;
```

- [ ] **Step 2: Change the limit to 10**

In `packages/core/src/hooks/useVoiceAgent.ts`, replace:

```typescript
  const MAX_CLIENT_ROUND_TRIPS = 3;
```

With:

```typescript
  const MAX_CLIENT_ROUND_TRIPS = 10;
```

Why 10: A form with 4 sections requires `(getFormSchema + fillFormFields) x 4 + final getFormSchema = 9` round-trips. 10 gives one round-trip of headroom. This is still a safety net against infinite loops — the server-side `stepCountIs(5)` in `packages/server/src/createChatHandler.ts:44` provides an additional bound per individual request.

- [ ] **Step 3: Verify the build passes**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useVoiceAgent.ts
git commit -m "fix(core): raise MAX_CLIENT_ROUND_TRIPS from 3 to 10

Multi-step forms require many round-trips for the
getFormSchema -> fillFormFields -> getFormSchema cycle. A form
with 4 sections needs up to 9 round-trips. The server-side
stepCountIs(5) still prevents runaway per-request."
```

---

### Task 4: Add user-visible fallback when limit is reached

When the limit IS hit, the agent currently just `console.warn`s and freezes with an eternal "Processing..." spinner. The user has no idea what happened. We should surface a message so the user knows to continue the conversation.

**Files:**
- Modify: `packages/core/src/hooks/useVoiceAgent.ts:573-577` (the guard block we edited in Task 1)

- [ ] **Step 1: Read the guard block from Task 1 to confirm current state**

Run: Read file at `packages/core/src/hooks/useVoiceAgent.ts` lines 569-585

Confirm it now says:
```typescript
      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) {
        console.warn(
          `[VoiceAgent] Client round-trip limit reached (${roundTripCountRef.current}/${MAX_CLIENT_ROUND_TRIPS})`
        );
        return;
      }
```

- [ ] **Step 2: Add a tool output with a limit-reached message so the SDK can close the tool call**

Replace the guard block with:

```typescript
      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) {
        console.warn(
          `[VoiceAgent] Client round-trip limit reached (${roundTripCountRef.current}/${MAX_CLIENT_ROUND_TRIPS})`
        );
        // Provide a synthetic tool output so the SDK doesn't hang waiting for it.
        // The model will see this and can respond to the user instead of stalling.
        chatAddToolOutput({
          toolCallId: toolCall.toolCallId,
          tool: toolCall.toolName,
          output: JSON.stringify({
            error: 'Round-trip limit reached. Ask the user to continue with the next step.',
          }),
        });
        return;
      }
```

This ensures:
1. The tool call gets an output (so the message resolves to `output-available`)
2. `sendAutomaticallyWhen` will NOT fire another request because `roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS`
3. The model sees the error in the conversation context if the user sends a follow-up
4. No eternal "Processing..." — the message completes and the UI returns to idle

- [ ] **Step 3: Verify the build passes**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`

Expected: No type errors. `chatAddToolOutput` is already in scope from the `useChat` destructuring at line 354.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/useVoiceAgent.ts
git commit -m "fix(core): provide synthetic tool output when round-trip limit reached

Instead of silently returning (leaving the UI stuck on Processing...),
provide a tool output with an error message. This unblocks the SDK
message state so the UI returns to idle, and gives the model context
about why the tool didn't execute."
```

---

### Task 5: Full build and manual verification

- [ ] **Step 1: Run full build**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`

Expected: All 4 packages build successfully with no errors.

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm typecheck`

Expected: No type errors across the monorepo.

- [ ] **Step 3: Verify the final state of the changed code**

Read `packages/core/src/hooks/useVoiceAgent.ts` lines 331-333 and confirm:
```typescript
  const roundTripCountRef = useRef(0);
  const lastAutoSendMsgIdRef = useRef<string | null>(null);
  const MAX_CLIENT_ROUND_TRIPS = 10;
```

Read lines 569-590 and confirm the guard block uses `>=`, has no pre-increment, and provides `chatAddToolOutput`:
```typescript
      if (!isClientTool) return;

      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) {
        console.warn(
          `[VoiceAgent] Client round-trip limit reached (${roundTripCountRef.current}/${MAX_CLIENT_ROUND_TRIPS})`
        );
        chatAddToolOutput({
          toolCallId: toolCall.toolCallId,
          tool: toolCall.toolName,
          output: JSON.stringify({
            error: 'Round-trip limit reached. Ask the user to continue with the next step.',
          }),
        });
        return;
      }
```

Read lines 400-421 and confirm `sendAutomaticallyWhen` guard was updated to `>=` (Task 2) and still has the only increment:
```typescript
    sendAutomaticallyWhen({ messages: msgs }) {
      if (roundTripCountRef.current >= MAX_CLIENT_ROUND_TRIPS) return false;
      // ... dedup logic unchanged ...
      if (complete) {
        lastAutoSendMsgIdRef.current = sendKey;
        roundTripCountRef.current++;
        // ...
      }
    },
```

- [ ] **Step 4: Commit the build artifacts if any**

If `pnpm build` produced updated dist files that are tracked, commit them:

```bash
git status
# If dist files changed:
git add packages/*/dist/
git commit -m "chore: rebuild dist after round-trip counter fix"
```

Note: dist files are likely `.gitignore`d — skip this step if git status shows no changes.

---

### Task 6: Release preparation

- [ ] **Step 1: Create a changeset**

Run:
```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit
pnpm changeset -- --empty
```

If `--empty` is not supported, manually create a changeset file:

```bash
cat > .changeset/fix-round-trip-counter.md << 'EOF'
---
"@unctad-ai/voice-agent-core": patch
---

Fix client tool round-trip counter that prevented multi-step form filling. The counter was double-incrementing (in both onToolCall and sendAutomaticallyWhen), exhausting the budget of 3 after just one fill cycle. Now counts only actual HTTP round-trips, raised limit to 10, and provides a graceful fallback instead of silently freezing.
EOF
```

- [ ] **Step 2: Commit the changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for round-trip counter fix"
```

- [ ] **Step 3: Verify everything is ready to release**

Run: `git log --oneline -5`

Expected output (roughly):
```
chore: add changeset for round-trip counter fix
fix(core): provide synthetic tool output when round-trip limit reached
fix(core): raise MAX_CLIENT_ROUND_TRIPS from 3 to 10
fix(core): align sendAutomaticallyWhen guard to use >= for round-trip limit
fix(core): remove double-increment in client tool round-trip counter
```

The branch is ready for `./scripts/release.sh` whenever you're ready to publish.
