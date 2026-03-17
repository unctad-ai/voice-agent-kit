# System Prompt Refactor

**Date:** 2026-03-17
**Status:** Implemented (with adjustments)

## Problem

The system prompt in `packages/server/src/systemPrompt.ts` has grown organically and has structural issues that hurt LLM compliance, especially on Qwen3-32B (our primary model via Groq).

## Changes (ranked by impact)

### HIGH

#### 1. ~~Add `/no_think` for Qwen3~~ — REVERTED

Qwen3-32B defaults to thinking mode, emitting `<think>...</think>` blocks before every response. For a voice assistant where latency matters, suppress this.

**Outcome:** `/no_think` was implemented then reverted. It suppressed Qwen3's reasoning step, causing the model to skip tool calls (e.g. `getFormSchema`) and generate text-only responses. The thinking step is where the model plans "I need to call getFormSchema per the rules." Without it, tool compliance dropped significantly.

**Current approach:** Let the model think; `stripChainOfThought` in `textUtils.ts` strips `<think>` blocks from TTS output. Groq does not expose `enable_thinking=false` at the API level.

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

#### 8. Set Qwen3 generation params — ADJUSTED

Qwen3's recommended non-thinking params: `temperature=0.7, topP=0.8, topK=20`. Verify these are set in the Groq API call, not left at defaults.

**File:** `packages/server/src/voicePipeline.ts` (streamText call)

**Outcome:** Set to `temperature=0.3, topP=0.8`. The recommended `temperature=0.7` was too loose — tool calling became unreliable. `topK=20` omitted because `@ai-sdk/groq` may not forward it to the Groq API.

#### 9. Remove behavioral instructions from tool descriptions

`searchServices` tool description says "immediately follow up with viewService" but the system prompt's PROACTIVE NAVIGATION rule says "call BOTH viewService AND getServiceDetails." Keep behavioral instructions only in the system prompt (single source of truth), keep tool descriptions factual.

### Findings from voice testing (2026-03-17)

These issues were observed during live testing and should be addressed in the refactor:

#### 10. Upload fields should be handled before text fields — IMPLEMENTED

When a section has an upload field first (e.g., passport OCR that auto-fills details), the LLM skips it and asks for text input. FORMS rule 8 (upload handling) needs to be stronger — upload fields MUST be processed before text fields in the same section.

**Outcome:** FORMS rule 8 rewritten to enforce upload-first ordering. Instructs the LLM to handle uploads before text fields, call `getFormSchema` after upload to see auto-filled values.

#### 11. TTS punctuation handling (em dashes, etc.) — OPEN

The LLM uses em dashes (" — ") which TTS reads without pausing. Need to investigate LuxTTS behavior with different punctuation before fixing `sanitizeForTTS`. Determine: what characters cause pauses, whether SSML `<break>` tags are supported, and what the current best practice is for the active TTS engine.

**Status:** Requires investigation. No code change yet.

#### 12. Premature completion claims — IMPLEMENTED

The LLM narrates future outcomes as facts ("I will send it now — your registration has been submitted") before the submit action executes. The confirmation rule exists but isn't being followed. Reinforce: "Never describe the outcome of an action before executing it."

**Outcome:** Added to FORMS rule 7: `NEVER describe the outcome of an action before it executes — say "let me submit that" not "your registration has been submitted."`

## Testing

- Deploy to Swkenya Docker dev
- Voice test each change in isolation where possible
- Measure latency impact of `/no_think`
- Test [INTERNAL:] → `<internal>` transition for leakage
- Verify FORMS numbered rules improve compliance vs current prose
