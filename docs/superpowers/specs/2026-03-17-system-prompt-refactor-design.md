# System Prompt Refactor

**Date:** 2026-03-17
**Status:** Proposed

## Problem

The system prompt in `packages/server/src/systemPrompt.ts` has grown organically and has structural issues that hurt LLM compliance, especially on Qwen3-32B (our primary model via Groq).

## Changes (ranked by impact)

### HIGH

#### 1. Add `/no_think` for Qwen3

Qwen3-32B defaults to thinking mode, emitting `<think>...</think>` blocks before every response. For a voice assistant where latency matters, suppress this.

**File:** `packages/server/src/systemPrompt.ts` (line 40)

Append `/no_think` to the identity line, or set `enable_thinking=false` at the Groq API level if available. Belt-and-suspenders: do both.

#### 2. Split FORMS into numbered sub-rules

The FORMS block is a single 10-sentence paragraph. Qwen3 follows structured rules better than prose blobs.

**Rewrite:**
```
FORMS: When on a /dashboard/* page:
1. ALWAYS call getFormSchema first — never guess field content.
2. Ask for a few details at a time, never dump all fields.
3. Batch-fill with fillFormFields once you have answers.
4. After every fillFormFields, call getFormSchema again — new sections may appear.
5. If a section has "gated":true with an "action", call performUIAction BEFORE asking for that section's data.
6. After filling all visible fields, check UI_ACTIONS for the next step (tab switch, etc.).
7. Advance actions (tab switches) — execute immediately. Submit/send actions — confirm with user first.
8. NEVER say a form is complete without calling getFormSchema to verify.
```

#### 3. Fix stale getFormSchema tool description

**File:** `packages/server/src/builtinTools.ts` (line ~150)

Current: `'Get available form field IDs and types. Call this ONCE before fillFormFields.'`

Fix to: `'Get currently visible form fields. Call before fillFormFields and again after each fill to discover new sections.'`

The "ONCE" directly contradicts the system prompt's "call again after every fillFormFields."

### MEDIUM

#### 4. Switch [INTERNAL:] to XML tags

`[INTERNAL: ...]` is a custom convention Qwen3 has no special training on. XML tags like `<internal>...</internal>` align with Qwen3's ChatML/XML training.

**Files:** `packages/registries/src/clientToolHandlers.ts` (4 occurrences), `packages/server/src/systemPrompt.ts` (rule 3)

Replace `[INTERNAL: ...]` with `<internal>...</internal>` and update rule 3 to: `"Never repeat text inside <internal> tags to the user."`

#### 5. Add current tab to dynamic context

**File:** `packages/server/src/systemPrompt.ts` (`buildSystemPrompt` function)

Add `currentTab?: string` to `ClientState` and emit:
```typescript
if (clientState.currentTab) {
  prompt += `\nActive form tab: ${clientState.currentTab}`;
}
```

Requires passing current tab from the client via the WebSocket session state.

#### 6. Reorder rules — group bail-out behaviors at end

Move SILENT (rule 5) and GOODBYE after FORMS. These are terminal/short-circuit behaviors that should come after the main instruction block.

### LOW

#### 7. Reconsider contractions rule

"Never use contractions" makes TTS sound robotic ("I am" vs "I'm"). If the rule exists to avoid TTS pronunciation bugs with apostrophes, document that. Otherwise consider relaxing.

#### 8. Set Qwen3 generation params

Qwen3's recommended non-thinking params: `temperature=0.7, topP=0.8, topK=20`. Verify these are set in the Groq API call, not left at defaults.

**File:** `packages/server/src/voicePipeline.ts` (streamText call)

#### 9. Remove behavioral instructions from tool descriptions

`searchServices` tool description says "immediately follow up with viewService" but the system prompt's PROACTIVE NAVIGATION rule says "call BOTH viewService AND getServiceDetails." Keep behavioral instructions only in the system prompt (single source of truth), keep tool descriptions factual.

## Testing

- Deploy to Swkenya Docker dev
- Voice test each change in isolation where possible
- Measure latency impact of `/no_think`
- Test [INTERNAL:] → `<internal>` transition for leakage
- Verify FORMS numbered rules improve compliance vs current prose
