# Audit & Fix Voice Agent Form Integration

Reusable prompt for auditing and fixing voice-agent form integrations in consuming projects.

## Parameters

Before running, set these values:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `PROJECT_PATH` | Absolute path to the consuming project | `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto` |
| `VOICE_BRANCH` | Branch with voice-agent integration | `feat/multi-voice-support` |
| `KIT_PATH` | Path to voice-agent-kit repo | `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit` |
| `MODE` | `audit` (read-only report) or `fix` (audit + apply fixes) | `audit` |

---

## Phase 1: Discovery

### 1.1 Find all voice-agent hook usage

```bash
cd $PROJECT_PATH
git checkout $VOICE_BRANCH
```

Search for files importing from `@unctad-ai/voice-agent-registries`:

```bash
grep -rl "voice-agent-registries" src/
```

This gives you the list of **form components** to audit.

### 1.2 Find voice-config files

```bash
ls src/voice-config.ts server/voice-config.ts 2>/dev/null
```

### 1.3 Find services data

```bash
grep -rl "serviceCategories\|services.*Category" src/data/
```

Read the services file and extract all service IDs (`id: '...'`). You'll need these for Step 3.4.

### 1.4 Read the golden reference

```bash
cat $KIT_PATH/docs/superpowers/specs/golden-reference/after.tsx
```

This is the canonical correct example. All patterns below are demonstrated in it.

### 1.5 Read the API contracts

```bash
cat $KIT_PATH/packages/registries/src/useProgressiveFields.ts
cat $KIT_PATH/packages/registries/src/UIActionRegistry.tsx
cat $KIT_PATH/packages/registries/src/FormFieldRegistry.tsx
```

Note: `FormFieldType = 'text' | 'email' | 'tel' | 'date' | 'select' | 'radio' | 'checkbox'`

---

## Phase 2: Audit each form component

For each file found in 1.1, check every criterion below. Record findings in the format shown in Phase 4.

> **Large file warning.** When delegating audits to subagents, ensure they read the FULL file — not just the first N lines. Agents that stop reading early produce false positives (e.g. reporting "missing submit action" when it exists further down). For files over 500 lines, instruct the agent to read in multiple chunks.

### 2.1 API migration

| # | Check | Correct | Wrong |
|---|-------|---------|-------|
| A1 | Uses `useProgressiveFields` (batched API) | Single `useProgressiveFields(prefix, steps)` call | Multiple `useRegisterFormField({...})` calls |

If the component uses individual `useRegisterFormField` calls, flag for migration.

### 2.2 Field type correctness

For each registered field, compare the `type` against the JSX element it controls:

| JSX element | Correct `type` | Common mistake |
|-------------|----------------|----------------|
| `<select>` | `select` with `options` array | `text` (no options) |
| `<input type="tel">` | `tel` | `text` |
| `<input type="email">` | `email` | `text` |
| `<input type="date">` | `date` | `text` |
| `<input type="radio">` | `radio` with `options` | `text` |
| `<input type="checkbox">` | `checkbox` | `text` or `radio` |
| `<textarea>` | `text` | — (correct as-is) |
| `<input type="number">` | `text` | — (`number` not in FormFieldType) |
| `<input type="text">` | `text` | — |

**For every `<select>` element:** extract the `<option>` values from the JSX and verify the registration includes matching `options: [{ value, label }]` array. Options should be extracted to module-scope constants (outside the component function).

### 2.3 Required flags

For each registered field:
1. Find its `<label>` in the JSX
2. Check if label contains `<span className="text-red-500">*</span>` (or equivalent required marker)
3. If yes → field must have `required: true`
4. If no → `required: false` (or omitted, which defaults to false)

### 2.4 ID convention

All field IDs must follow `{prefix}.{section}.{field}` pattern:
- `prefix` = component prefix (e.g. `pin-reg`, `evaluate-investment`, `phyto`)
- `section` = logical grouping (e.g. `project`, `director`, `applicant`)
- `field` = camelCase field name (e.g. `firstName`, `dateOfBirth`)

### 2.5 Label convention

Labels must be domain-prefixed to avoid ambiguity:
- "Director first name" (not just "First name")
- "Project county" (not just "County")
- "Applicant email" (not just "Email")

### 2.6 Visibility / enabled conditions

For each field, walk up the JSX tree from its `<input>`/`<select>`:
1. Collect all `{condition && (...)}` gates
2. AND them together
3. This is the correct `visible` (in useProgressiveFields) or `enabled` (in useRegisterFormField) value

Common patterns:
- `showDirectorForm && hasUploadedFile && !isProcessingPassport` → passport-gated fields
- `hasProjectReference === 'no' || projectDataQueried` → project fields
- `activeTab === 'send'` → consent/submit fields

**Check:** Does the registration's visibility match the JSX nesting?

### 2.7 Object state setter pattern

For fields bound to object state (e.g. `currentDirector.firstName`):

```typescript
// CORRECT — uses prev => pattern (avoids stale closures)
bind: [currentDirector.firstName, (v) => setCurrentDirector(prev => ({...prev, firstName: v as string}))]

// WRONG — stale closure
bind: [currentDirector.firstName, (v) => setCurrentDirector({...currentDirector, firstName: v as string})]
```

### 2.8 UI actions

For each `useRegisterUIAction`:
1. Handler must return a descriptive string (not `undefined`)
2. Parameterized actions need `params` spec with `name`, `description`, `type`
3. Actions wrapping callbacks should use `useCallback` with correct deps

### 2.9 Tab switch action

- Must use `useRegisterTabSwitchAction(prefix, tabs, setter, category)`
- `tabs` must match the component's tab type (e.g. `['form', 'send'] as const`)

### 2.10 Submit action

- Must use `useRegisterSubmitAction(prefix, { guard, onSubmit, ... })`
- `guard` must check preconditions and return error string or `null`
- `onSubmit` should match the original submit handler

### 2.11 Skipped state

These useState variables should NOT be registered as form fields:
- UI toggle/flag state (modals, accordions, loading indicators)
- Collection/array state (expose via UI actions instead)
- Loading/error/processing indicators
- Derived/computed state
- Validation error state

---

## Phase 3: Audit voice-config files

### 3.1 Client voice-config (`src/voice-config.ts`)

- `services` references actual data from services file
- `routeMap` keys match actual routes in App.tsx
- `getServiceFormRoute` returns correct paths
- `synonyms` entries are reasonable

### 3.2 Server voice-config (`server/voice-config.ts`)

- Same checks as client config
- **Service ID check:** any hardcoded service IDs (in `coreIds`, `filter`, etc.) must match actual IDs from the services data file
- `extraServerTools` (if any) use correct service IDs in their logic

### 3.3 Cross-reference service IDs

```bash
# Extract all IDs from services data
grep "id:" src/data/services.ts | sed "s/.*id: '\\(.*\\)'.*/\\1/"

# Extract all IDs referenced in server voice-config
grep -oE "'[a-z-]+'" server/voice-config.ts
```

Any ID in the voice-config that doesn't exist in services data is a bug.

---

## Phase 4: Output format

Write findings to `$KIT_PATH/docs/superpowers/specs/audits/{project-name}-audit.md`:

```markdown
# Voice Agent Integration Audit — {Project Name}

**Date:** YYYY-MM-DD
**Branch:** {branch}
**Components audited:** {list}

## Summary

{X bugs found across Y files. Z are high severity.}

## Findings

### {Component filename}

#### Bug {N}: {title}
- **Severity:** High | Medium | Low
- **Check:** {which check from 2.x}
- **Line(s):** {line numbers}
- **Current:** {what's there now}
- **Correct:** {what it should be}

### voice-config.ts

#### Bug {N}: {title}
...

## Correctly implemented

- {list of checks that passed}

## Migration plan

1. {ordered list of fixes}
```

---

## Phase 5: Fix (if MODE=fix)

Apply fixes in this order.

> **Critical — read the JSX first.** Before writing any field registration, read the FULL component file including its JSX return block. Registration-block-only context leads to hallucinated field types and fabricated options. When delegating migration to a subagent, explicitly instruct it to read the entire file (JSX included) before writing field configs.

### 5.1 Migrate to useProgressiveFields

1. Change import: `useRegisterFormField` → `useProgressiveFields`
2. Extract `<select>` options to module-scope constants (above the component)
3. Replace all `useRegisterFormField` calls with one `useProgressiveFields(prefix, steps)` call
4. Group fields into steps by visibility condition
5. Use `bind: [value, setter]` tuple instead of separate `value`/`setter`/`enabled`
6. Step `visible` replaces per-field `enabled` (use per-field `visible` for additional overrides within a step)

### 5.2 Fix field types and options

For each field, **read its corresponding JSX element** to determine the correct type:

- `<input type="text">` or `<textarea>` → `type: 'text'` — do NOT add `options`
- `<select>` → `type: 'select'` — extract options from the `<option>` elements in the JSX
- `<input type="radio">` → `type: 'radio'` — extract options from the radio group in the JSX

**NEVER assign `type: 'select'` unless the JSX actually renders a `<select>` element.** Many fields that look like they could be dropdowns (county, sector, nationality) are actually free-text `<input type="text">` in the JSX. Trust the JSX, not your assumptions.

**NEVER fabricate option values.** Only extract options that exist as `<option>` or radio elements in the source JSX. If the JSX has `<input type="text">`, the field has no options — period.

For each confirmed `<select>` element:
1. Create a module-scope `const X_OPTIONS = [{ value, label }, ...]` from the JSX `<option>` elements
2. Set `type: 'select'` and `options: X_OPTIONS` on the field config

### 5.3 Fix required flags

Only set `required: true` if you have **visually confirmed** the required marker (`<span className="text-red-500">*</span>` or equivalent) in the field's JSX label. Default to omitting `required` (which defaults to `false`). Do not guess based on field importance.

### 5.4 Fix UI actions

Wrap any handler that doesn't return a string:
```typescript
// Before
useRegisterUIAction('prefix.action', 'desc', existingHandler, opts);
// After
useRegisterUIAction('prefix.action', 'desc', () => {
  existingHandler();
  return 'Descriptive result message.';
}, opts);
```

### 5.5 Fix voice-config service IDs

Replace any stale IDs with the correct ones from the services data file.

### 5.6 Verify

Run the build after each file migration — not just once at the end:

```bash
npm run build  # or pnpm build
```

If the build fails, revert the broken file (`git checkout -- path/to/file.tsx`) and re-attempt the migration for that file only. Do not continue fixing other files while the build is broken. Commit passing files incrementally if needed to avoid losing progress.

### 5.7 Commit

```bash
git add -A
git commit -m "fix: audit and fix voice-agent form integration

- Migrate useRegisterFormField to useProgressiveFields
- Fix select field types with proper options
- Fix required flags to match JSX markers
- Fix stale service IDs in voice-config"
```

---

## Quick reference: golden reference patterns

### useProgressiveFields structure

```typescript
useProgressiveFields('prefix', [
  {
    step: 'Section name',           // shown to LLM as field grouping
    visible: booleanCondition,       // step-level visibility gate
    fields: [
      {
        id: 'section.fieldName',     // prefix is added automatically
        label: 'Domain-prefixed label',
        type: 'select',              // matches JSX element type
        required: true,              // matches JSX required marker
        options: MODULE_SCOPE_CONST, // for select/radio types
        visible: perFieldOverride,   // optional, ANDed with step.visible
        bind: [stateValue, (v) => setter(v as Type)],
      },
    ],
  },
]);
```

### Module-scope option constants

```typescript
const NATIONALITY_OPTIONS = [
  { value: 'USA', label: 'United States' },
  { value: 'UK', label: 'United Kingdom' },
];
```

### Object state setter

```typescript
bind: [obj.prop, (v) => setObj(prev => ({ ...prev, prop: v as string }))]
```

### useRegisterUIAction

```typescript
// Signature:
useRegisterUIAction(
  id: string,                                          // e.g. 'pin-reg.addDirector'
  description: string,                                 // human-readable for LLM
  handler: (params?: Record<string, unknown>) => unknown,  // MUST return a descriptive string
  options?: { category?: string; params?: UIActionParam[] }
)

// Simple action (no params):
useRegisterUIAction(
  'prefix.actionName',
  'Description of what this does',
  () => {
    doSomething();
    return 'Descriptive result of what happened.';
  },
  { category: 'prefix' }
);

// Parameterized action (with useCallback):
const handleByIndex = useCallback(
  (params?: Record<string, unknown>) => {
    const index = Number(params?.index);
    if (isNaN(index) || index < 0 || index >= items.length) return 'Invalid index';
    doSomething(items[index]);
    return `Action completed on item ${index}`;
  },
  [items]
);
useRegisterUIAction('prefix.action', 'Description', handleByIndex, {
  category: 'prefix',
  params: [{ name: 'index', description: 'Item index (0-based)', type: 'number' }],
});
```

### useRegisterTabSwitchAction

```typescript
// Signature:
useRegisterTabSwitchAction(
  prefix: string,                    // e.g. 'pin-reg'
  validTabs: readonly string[],      // e.g. ['form', 'send'] as const
  setActiveTab: (tab: string) => void,
  category?: string                  // defaults to prefix
)

// Usage:
useRegisterTabSwitchAction(
  'pin-reg',
  ['form', 'send'] as const,
  (tab) => setActiveTab(tab as Tab),
  'pin-registration'
);
```

### useRegisterSubmitAction

```typescript
// Signature:
useRegisterSubmitAction(
  prefix: string,                    // e.g. 'pin-reg' → registers 'pin-reg.submitApplication'
  options: {
    description?: string;            // default: 'Submit the application'
    guard?: () => string | null;     // return error string or null (passes)
    onSubmit: () => void;            // the actual submit handler
    successMessage?: string;         // default: 'Application submitted successfully...'
    category?: string;               // defaults to prefix
  }
)

// Usage:
useRegisterSubmitAction('pin-reg', {
  description: 'Submit the PIN registration application',
  guard: () => {
    if (activeTab !== 'send') return 'Switch to the Send tab first';
    if (!consentChecked) return 'Consent checkbox must be checked';
    return null;
  },
  onSubmit: () => navigate('/dashboard'),
  category: 'pin-registration',
});
```
