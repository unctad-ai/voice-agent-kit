# Multi-Tab Form Navigation Awareness

**Date:** 2026-03-17
**Status:** Approved

## Problem

The voice agent fills the first tab of a multi-tab form (e.g. the Guide tab in Swkenya's company registration) but then declares the form complete. It doesn't know to advance to the next tab.

**Root cause:** The system prompt only teaches progressive section reveals within a single tab. After filling all visible fields, the auto-`getFormSchema` returns the same fields (now filled), and the LLM concludes the form is done. It never checks UI_ACTIONS for a tab-switch action.

The machinery already exists — `reg-company.switchTab` is registered as a UI action and visible to the LLM in `UI_ACTIONS`. The LLM just doesn't know when or why to use it.

## Design

Two kit-level changes (Approach C from brainstorming). No changes to consuming projects.

### Change 1: System prompt — multi-tab awareness

**File:** `packages/server/src/systemPrompt.ts` (FORMS paragraph, line 34)

Append to the existing FORMS rule:

> "Forms may span multiple tabs. After filling all visible fields, check UI_ACTIONS for the next step. Advance actions like tab switches should be executed to continue filling. Actions that submit, send, or have irreversible effects require user confirmation first."

This teaches the LLM the concept of multi-tab forms and how to decide between auto-advancing and confirming.

### Change 2: `getFormSchema` completion hint

**File:** `packages/registries/src/clientToolHandlers.ts` (case `'getFormSchema'`, ~line 81)

After building the schema response, check if every visible field has a non-empty value. If so, add a `hint` property to the JSON response.

**"All filled" heuristic:** A field is considered filled if its value is not `null`, `undefined`, or `''`. Booleans (`false` for unchecked checkboxes) and numbers (`0`) are valid filled values — do not treat them as empty.

```typescript
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value !== '';
  return true; // booleans, numbers, arrays are filled
}
```

**Both code paths must be handled.** `getFormSchema` has two return shapes:
- **Grouped** (has sections): returns `{sections: [...]}` — add `hint` as a sibling property
- **Ungrouped** (flat array): currently returns `[...]` — wrap in `{fields: [...], hint: "..."}` when the hint applies, keep flat array when it doesn't (to avoid breaking existing behavior for forms without the hint)

```typescript
const allFilled = fields.length > 0 && fields.every(f => isFilled(f.value));
const hint = allFilled
  ? 'All visible fields are filled. Check UI_ACTIONS for the next step.'
  : undefined;

// Grouped path
if (hasGroups) {
  const result: any = { sections: [...] };
  if (hint) result.hint = hint;
  return JSON.stringify(result);
}
// Ungrouped path
if (hint) return JSON.stringify({ fields: fields.map(fieldToSchema), hint });
return JSON.stringify(fields.map(fieldToSchema));
```

The hint is a JSON property — the LLM sees it naturally in the tool result. It triggers at exactly the right moment: after the auto-`getFormSchema` post-fill refresh.

### What does NOT change

- No changes to Swkenya or any consuming project
- No changes to `performUIAction`, `fillFormFields`, `useRegisterTabSwitchAction`
- No new tools — uses existing `performUIAction` + registered `switchTab` actions
- No changes to the auto-`getFormSchema` pipeline in `voicePipeline.ts`
- Existing completion guard stays: "NEVER say a form is complete or suggest submitting without calling getFormSchema first to verify no unfilled fields remain"

## Expected Behavior

1. User: "Fill the form for me, don't ask questions"
2. LLM calls `getFormSchema` → sees Guide tab fields
3. LLM calls `fillFormFields` → fills guide fields
4. Auto-`getFormSchema` fires → all fields filled → response includes `hint: "All visible fields are filled. Check UI_ACTIONS for the next step."`
5. LLM sees hint + knows from system prompt about multi-tab forms → calls `performUIAction("reg-company.switchTab", {"tab":"form"})`
6. New tab renders → `getFormSchema` returns new unfilled fields → LLM continues filling
7. Repeats through form → documents → send tabs
8. On final tab, LLM sees submit action in UI_ACTIONS → asks user for confirmation

## Safety

The existing `roundTripCountRef` (max 25 tool rounds per turn) in `voicePipeline.ts` prevents infinite tab-cycling. If the LLM switches to a tab whose fields are already filled, the hint fires again, but the round-trip limit will stop it. In practice this shouldn't happen — switching to a new tab renders new unfilled fields.

## Testing

- Deploy to Swkenya Docker dev (`pnpm docker:kenya`)
- Voice test: "Fill the form for me, don't ask any questions"
- Verify agent advances through all tabs automatically
- Verify agent asks for confirmation before submitting
- Verify that on the final tab, if no submit UI action exists, the LLM does not fabricate one
