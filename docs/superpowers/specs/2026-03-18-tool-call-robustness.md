# Tool Call Robustness Fixes

**Date:** 2026-03-18
**Status:** Specced
**Priority:** Medium — user-facing failures

## Problem 1: paramsJson type mismatch

Qwen3 sometimes sends `paramsJson` as a JSON object instead of a string. The Zod schema (`z.string().optional()`) rejects it before the client-side coercion in `clientToolHandlers.ts` ever runs. The user hears silence and has to repeat themselves (see session `2e23152c` turn 13).

### Fix

In `packages/server/src/builtinTools.ts`, change the `paramsJson` schema from:
```ts
paramsJson: z.string().optional()
```
to a `z.preprocess` that stringifies objects:
```ts
paramsJson: z.preprocess(
  (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v),
  z.string().optional()
)
```

This catches the LLM's mistake at the schema level and converts it to the expected string format.

## Problem 2: "Yes, do it" → LLM re-asks instead of filling

When the user confirms "Yes, do it" after "Shall I fill these fields for you?", the LLM asks for real data instead of filling immediately with example values. The system prompt's FORMS rules say "ask for a few fields at a time" but don't cover this confirmation-without-values case.

### Fix

In `packages/server/src/systemPrompt.ts`, add a rule to the FORMS section:

> When the user confirms filling (e.g. "yes", "do it", "go ahead", "use placeholder") without providing specific values, fill immediately with realistic example data. Do not re-ask for the same fields.

## Testing

- Send a `performUIAction` tool call with `paramsJson` as an object — should succeed
- In a voice session, ask to fill fields, then confirm "yes" without giving data — should fill immediately
