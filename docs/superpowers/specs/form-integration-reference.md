# Voice Agent Form Integration — Kenya PIN Registration Reference

Real transformation of `PinRegistrationApplication.tsx` (1342→2030 lines).

## P1: Import additions

```tsx
// BEFORE
import { useState, useEffect, useRef } from 'react';
// AFTER — add useCallback, add registry hooks
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  useRegisterUIAction,
  useRegisterTabSwitchAction,
  useRegisterSubmitAction,
  useRegisterFormField,
} from '@unctad-ai/voice-agent-registries';
```

## P2: Simple string field → useRegisterFormField

```tsx
// ORIGINAL STATE:
const [projectName, setProjectName] = useState('');
// ORIGINAL JSX (inside {(hasProjectReference === 'no' || projectDataQueried) && (...)}):
//   <label>Name <span className="text-red-500">*</span></label>
//   <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />

// GENERATED HOOK (placed after all useState, before any useEffect):
const projectFieldsVisible = hasProjectReference === 'no' || projectDataQueried;
useRegisterFormField({
  id: 'pin-reg.project.name',       // prefix.section.field
  label: 'Project name',            // from <label> + section context
  type: 'text',                      // from <input type="text">
  required: false,                   // from <span className="text-red-500">*</span>? See note
  value: projectName,
  setter: (v: unknown) => setProjectName(v as string),
  enabled: projectFieldsVisible,     // from JSX conditional gate
});
```

**Label derivation:** JSX `<label>Name</label>` + section heading "Information on your investment project" → "Project name".
**Enabled derivation:** field is inside `{(hasProjectReference === 'no' || projectDataQueried) && (...)}` → extracted to `projectFieldsVisible` variable.

## P3: Object state (currentDirector) → per-property registration

```tsx
// ORIGINAL STATE:
const [currentDirector, setCurrentDirector] = useState<Director>({...});
// ORIGINAL JSX (inside {showDirectorForm && ...} > {hasUploadedFile && ...}):
//   <label>First name *</label>
//   <input value={currentDirector.firstName} onChange={e => setCurrentDirector({...currentDirector, firstName: e.target.value})} />

// GENERATED — one hook PER property:
const passportProcessed = showDirectorForm && hasUploadedFile && !isProcessingPassport;
useRegisterFormField({
  id: 'pin-reg.director.firstName',
  label: 'Director first name',
  type: 'text',
  required: true,
  value: currentDirector.firstName,
  setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, firstName: v as string })),
  //      ^^^ MUST use prev => pattern (not spread from closure) for object state
  enabled: passportProcessed,
});
```

**Key:** original `{...currentDirector, prop: val}` becomes `prev => ({...prev, prop: val})` to avoid stale closures when multiple fields are set in one batch.

## P4: UI Action registration

```tsx
// BUTTON ACTION — wraps existing handler, returns descriptive string
useRegisterUIAction(
  'pin-reg.addDirector',
  'Open the add director form to add a new foreign director',
  () => {
    handleAddDirector();
    return 'Director form opened. The form currently shows ONLY a required "Upload passport copy" field...';
  },
  { category: 'pin-registration' }
);

// SIMULATED ASYNC ACTION — wraps handler, describes what will happen
useRegisterUIAction(
  'pin-reg.uploadPassport',
  'Upload and process a passport document (simulated)',
  () => {
    handleSimulateUpload();
    return 'Passport uploaded and processing started. The system is validating the document...';
  },
  { category: 'pin-registration' }
);

// PARAMETERIZED ACTION — useCallback + params spec
const handleDeleteDirectorByIndex = useCallback(
  (params?: Record<string, unknown>) => {
    const index = Number(params?.index);
    if (isNaN(index) || index < 0 || index >= directors.length) return 'Invalid director index';
    handleDeleteDirector(directors[index].id);
    return `Deleted director at index ${index}`;
  },
  [directors]
);
useRegisterUIAction('pin-reg.deleteDirector', 'Delete a director by index', handleDeleteDirectorByIndex, {
  category: 'pin-registration',
  params: [{ name: 'index', description: 'Director index (0-based)', type: 'number' }],
});
```

## P5: Tab switch

```tsx
useRegisterTabSwitchAction(
  'pin-reg',                         // prefix
  ['form', 'send'] as const,        // from type Tab = 'form' | 'send'
  (tab) => setActiveTab(tab as Tab), // wraps existing setter
  'pin-registration'                 // category
);
```

## P6: Submit action

```tsx
useRegisterSubmitAction('pin-reg', {
  description: 'Submit the application (click "Validate and send" button on the Send tab).',
  guard: () => {
    if (activeTab !== 'send') return 'Cannot submit — not on Send tab. Use pin-reg.validateForm first.';
    if (!consentChecked) return 'Cannot submit — consent checkbox not checked.';
    return null;  // null = guard passes
  },
  onSubmit: () => navigate('/dashboard'),  // from original: onClick={() => navigate('/dashboard')}
  category: 'pin-registration',
});
```

## P7: Enabled condition derivation (3 examples)

| JSX nesting | Derived `enabled` expression |
|---|---|
| `{showDirectorForm && (<div>...<label>First name</label>...)}` | `showDirectorForm && hasUploadedFile && !isProcessingPassport` (also gated by `{hasUploadedFile && ...}` and must wait for processing) |
| `{(hasProjectReference === 'no' \|\| projectDataQueried) && (...<label>Name</label>...)}` | `hasProjectReference === 'no' \|\| projectDataQueried` (extracted to `projectFieldsVisible` var) |
| `{activeTab === 'send' && (...<input type="checkbox" checked={consentChecked}>...)}` | `activeTab === 'send'` |

**Rule:** Walk up the JSX tree from the field's `<input>`, collect all `{condition && ...}` gates → AND them together. If multiple conditions share the same gate, extract to a named variable.

## P8: What was SKIPPED

**Skipped useState (not registered as form fields):**
- `activeTab` — UI navigation state, handled by `useRegisterTabSwitchAction` instead
- `directors` (array) — collection state; individual directors edited via `currentDirector` + UI actions
- `showDirectorForm`, `editingDirectorId` — internal UI toggle state, not user-fillable
- `isProcessingPassport`, `hasUploadedFile`, `isImageLoading` — async processing flags
- `showProjectReferenceSection` — derived visibility gate
- `validationErrors` — transient error state
- `projectDataQueried`, `isQueryingProject` — API call state
- `projectReference` — text input for reference number (used only with "yes" path, not exposed to copilot)
- `isInfoCardOpen` — sidebar accordion toggle

**Rule:** Skip any useState that is: (a) a UI toggle/flag not directly fillable by voice, (b) a collection/array (expose via UI actions instead), (c) a loading/error/processing indicator, or (d) derived state used only for conditional rendering.

**Skipped JSX regions:** sidebar "Important information" panel, director card list rendering, file upload drag-and-drop area — these are display-only or require browser interaction (file picker).
