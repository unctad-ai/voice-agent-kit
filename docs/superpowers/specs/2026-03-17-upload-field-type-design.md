# Upload Field Type for Voice Agent

**Date:** 2026-03-17
**Status:** Approved

## Problem

Forms have file upload areas (passport copies, articles of association) that the voice agent cannot interact with. When the agent hits these sections, it gets stuck or confused — no structured signal tells it "this requires manual user action."

## Design

Add `'upload'` to `FormFieldType`. Consuming projects register upload placeholders via `useProgressiveFields`. The agent sees them in `getFormSchema` and knows to tell the user to handle it manually.

### Change 1: Add `'upload'` to FormFieldType

**File:** `packages/registries/src/FormFieldRegistry.tsx`

```typescript
export type FormFieldType = 'text' | 'email' | 'tel' | 'date' | 'select' | 'radio' | 'checkbox' | 'upload';
```

### Change 2: Skip upload fields in `fillFormFields`

**File:** `packages/registries/src/clientToolHandlers.ts`

In the `fillFormFields` case, skip fields with `type === 'upload'`:
```typescript
if (fieldDef?.type === 'upload') {
  errors.push(`"${entry.fieldId}" is a file upload — the user must handle it manually`);
  continue;
}
```

### Change 3: Exclude upload fields from `allFilled` check

**File:** `packages/registries/src/clientToolHandlers.ts`

Upload fields should not block the "all filled" hint since the agent can't fill them:
```typescript
const fillableFields = fields.filter(f => f.type !== 'upload');
const allFilled = fillableFields.length > 0 && fillableFields.every(f => isFilled(f.value));
```

### Change 4: System prompt — teach about upload fields

**File:** `packages/server/src/systemPrompt.ts`

Add to FORMS section: "Fields with type 'upload' are file uploads the user must complete manually — inform them and continue to the next fillable field."

### Change 5: Consuming project usage

**Example (PinRegistration passport upload):**
```typescript
{
  step: 'Director Details',
  visible: activeTab === 'form',
  ready: showDirectorForm,
  gatedAction: 'pin-reg.addDirector',
  fields: [
    { id: 'director.passportUpload', type: 'upload', label: 'Upload passport copy', bind: [null, () => {}] },
    { id: 'director.firstName', type: 'text', label: 'Director first name', ... },
    // ... other fields
  ],
}
```

## Expected Behavior

1. Agent calls `getFormSchema` → sees `{ type: 'upload', label: 'Upload passport copy' }` among fields
2. Agent tells user: "You will need to upload your passport copy manually"
3. Agent continues filling other fields in the section
4. Upload fields don't block the "all filled" hint
5. If agent tries to fill an upload field, it gets a clear error message

## What does NOT change

- No changes to `useProgressiveFields` logic (upload is just a new type value)
- No changes to `getFormSchema` output structure
- No changes to `FormFieldRegistry` registration logic
- Backwards-compatible — existing forms without upload fields are unaffected
