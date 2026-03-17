# Multi-Tab Form Navigation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the voice agent advance through multi-tab forms instead of stopping after the first tab.

**Architecture:** Two kit-level changes — a system prompt addition teaches the LLM about multi-tab forms, and a `getFormSchema` hint nudges it to check UI_ACTIONS when all visible fields are filled.

**Tech Stack:** TypeScript, voice-agent-kit packages (server, registries)

**Spec:** `docs/superpowers/specs/2026-03-17-multi-tab-form-navigation-design.md`

---

### Task 1: Add `isFilled` helper and hint to `getFormSchema`

**Files:**
- Modify: `packages/registries/src/clientToolHandlers.ts:81-106`

- [ ] **Step 1: Add `isFilled` helper above `createClientToolHandler`**

Add this function at module level (after the `resolveServiceTitle` function, before the `ClientToolDeps` interface):

```typescript
/** Check if a form field value counts as "filled" (not empty/null/undefined). */
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value !== '';
  return true; // booleans, numbers, arrays are valid filled values
}
```

- [ ] **Step 2: Add hint logic to the `getFormSchema` case**

Replace the `getFormSchema` case (lines 81-107) with:

```typescript
      case 'getFormSchema': {
        const fields = getFormFields();
        if (fields.length === 0)
          return 'No form fields are visible right now. The form may need a UI action first — check UI_ACTIONS for the next step (e.g. "Add Director").';
        const fieldToSchema = (f: FormField) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          value: f.value ?? null,
          ...(f.options?.length ? { opts: f.options } : {}),
        });
        const allFilled = fields.every(f => isFilled(f.value));
        const hint = allFilled
          ? 'All visible fields are filled. Check UI_ACTIONS for the next step.'
          : undefined;

        const hasGroups = fields.some((f) => f.group);
        if (!hasGroups) {
          if (hint) return JSON.stringify({ fields: fields.map(fieldToSchema), hint });
          return JSON.stringify(fields.map(fieldToSchema));
        }
        const sectionMap = new Map<string, FormField[]>();
        for (const f of fields) {
          const key = f.group || '_ungrouped';
          const arr = sectionMap.get(key);
          if (arr) arr.push(f);
          else sectionMap.set(key, [f]);
        }
        const result: Record<string, unknown> = {
          sections: Array.from(sectionMap.entries()).map(([section, sectionFields]) => ({
            section: section === '_ungrouped' ? 'Other' : section,
            fields: sectionFields.map(fieldToSchema),
          })),
        };
        if (hint) result.hint = hint;
        return JSON.stringify(result);
      }
```

- [ ] **Step 3: Build and typecheck**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/registries/src/clientToolHandlers.ts
git commit -m "feat(registries): add all-filled hint to getFormSchema for multi-tab navigation"
```

---

### Task 2: Add multi-tab awareness to system prompt

**Files:**
- Modify: `packages/server/src/systemPrompt.ts:34`

- [ ] **Step 1: Append multi-tab instruction to FORMS paragraph**

In the `BASE_RULES` string, at the end of the FORMS paragraph (line 34), append after "...no unfilled fields remain.":

```
 Forms may span multiple tabs. After filling all visible fields, check UI_ACTIONS for the next step. Advance actions like tab switches should be executed to continue filling. Actions that submit, send, or have irreversible effects require user confirmation first.
```

The full FORMS line should now read (one continuous string):

```
FORMS: When on a /dashboard/* page, ALWAYS call getFormSchema to see what fields are actually visible — NEVER guess or fabricate form content. The schema is the single source of truth for what the user sees. Ask conversationally for a few details at a time — never dump all field names at once. Batch-fill with fillFormFields once you have the information. When getFormSchema returns sections, guide the user through the FIRST section only. More sections appear automatically as the user answers questions — call getFormSchema again after every fillFormFields to see newly visible fields. NEVER say a form is complete or suggest submitting without calling getFormSchema first to verify no unfilled fields remain. Forms may span multiple tabs. After filling all visible fields, check UI_ACTIONS for the next step. Advance actions like tab switches should be executed to continue filling. Actions that submit, send, or have irreversible effects require user confirmation first.
```

- [ ] **Step 2: Build and typecheck**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/systemPrompt.ts
git commit -m "feat(server): teach LLM about multi-tab form navigation in system prompt"
```

---

### Task 3: Integration test with Swkenya Docker dev

**Files:** None (manual testing)

- [ ] **Step 1: Build kit and start Docker**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit && pnpm build && pnpm docker:kenya`

- [ ] **Step 2: Voice test — multi-tab advancement**

Open http://localhost:3000, navigate to company registration, and say:
"Fill the form for me, don't ask me any questions"

Expected: Agent fills Guide tab fields → advances to Form tab → continues filling → advances through remaining tabs.

Check docker logs for:
- `performUIAction` calls with `switchTab`
- `hint` property in auto-schema responses
- No infinite loops (round count stays reasonable)

- [ ] **Step 3: Voice test — confirmation on submit**

On the final tab, verify the agent asks for confirmation before executing a submit action.

- [ ] **Step 4: Voice test — no fabricated actions**

Verify that if no submit UI action is registered on the final tab, the agent does not fabricate one.
