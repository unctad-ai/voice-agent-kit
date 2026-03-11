# Golden Reference Audit — Kenya PinRegistrationApplication

**Date:** 2026-03-11
**Source branch:** `voice-agent-refactor` in `unctad-ai/Kenyaservices`
**File:** `src/components/PinRegistrationApplication.tsx` (~2030 lines)

## Summary

The existing integration is ~80% correct but has systematic type bugs, missing `required` flags, and uses the deprecated per-field API instead of the canonical `useProgressiveFields` batched API. Server config has stale service IDs.

## Bug 1: Uses `useRegisterFormField` instead of `useProgressiveFields`

**Severity:** High (API migration)
**Lines:** 127–416 (~30 individual calls)

All form field registrations use individual `useRegisterFormField` calls. The canonical API is `useProgressiveFields` which batches fields into steps with shared visibility.

**Fix:** Replace all 30 `useRegisterFormField` calls with one `useProgressiveFields('pin-reg', steps)` call.

## Bug 2: Wrong `type` for `<select>` elements (registered as `text`)

**Severity:** High (FormFieldRegistry validates options; LLM gets wrong field type)

| Field ID | Registered type | JSX element | Correct type | Options |
|----------|----------------|-------------|--------------|---------|
| `pin-reg.project.county` | `text` | `<select>` | `select` | Nairobi, Mombasa, Kisumu |
| `pin-reg.project.subCounty` | `text` | `<select>` | `select` | Westlands, Kasarani |
| `pin-reg.project.sector` | `text` | `<select>` | `select` | ICT, Manufacturing, Agriculture, Tourism |
| `pin-reg.project.activity` | `text` | `<select>` | `select` | Software, Manufacturing |
| `pin-reg.project.nationality` | `text` | `<select>` | `select` | Foreign, Local, Joint |
| `pin-reg.director.nationality` | `text` | `<select>` | `select` | USA, UK, China, India, Germany |
| `pin-reg.director.issuingCountry` | `text` | `<select>` | `select` | USA, UK, China, India, Germany |
| `pin-reg.director.country` | `text` | `<select>` | `select` | Kenya, USA, UK |
| `pin-reg.director.countryCode` | `text` | `<select>` | `select` | +254, +1, +44, +86 |

9 fields affected.

## Bug 3: Wrong `required` flags on project fields

**Severity:** Medium (LLM won't prompt user for required fields)

JSX uses `<span className="text-red-500">*</span>` to mark required fields, but registrations have `required: false`.

| Field ID | Registered | JSX has `*` | Correct |
|----------|-----------|-------------|---------|
| `pin-reg.project.name` | `false` | Yes | `true` |
| `pin-reg.project.county` | `false` | Yes | `true` |
| `pin-reg.project.subCounty` | `false` | Yes | `true` |
| `pin-reg.project.sector` | `false` | Yes | `true` |
| `pin-reg.project.activity` | `false` | Yes | `true` |
| `pin-reg.project.description` | `false` | Yes | `true` |
| `pin-reg.project.nationality` | `false` | Yes | `true` |
| `pin-reg.project.amount` | `false` | Yes | `true` |
| `pin-reg.director.nationality` | `false` | Yes (`*`) | `true` |
| `pin-reg.director.gender` | `false` | Yes (`*`) | `true` |

## Bug 4: Stale `coreIds` in `server/voice-config.ts`

**Severity:** High (recommendServices tool silently returns empty results for core services)
**Line:** 87

```typescript
// CURRENT (wrong):
const coreIds = ['company-registration', 'work-permit', 'investor-certificate'];
// CORRECT (from src/data/services.ts):
const coreIds = ['register-company', 'request-work-permits', 'investment-certificate'];
```

## Bug 5: Missing return string on `cancelDirector` UI action

**Severity:** Low (LLM gets `undefined` instead of a descriptive result)
**Line:** 759–763

`handleCancelDirector` is passed directly as the handler. It likely doesn't return a string. Should wrap it to return a description.

## Bug 6: `number` type fields registered as `text`

**Severity:** None (acceptable) — `FormFieldType` does not include `number`. Fields `projectAmount`, `projectLocalStaff`, `projectForeignStaff` are correctly `text` even though JSX uses `<input type="number">`.

## Correctly implemented patterns

These are already correct and should be preserved:

- ✅ `prev =>` setter pattern for `currentDirector` object state (all director fields)
- ✅ `date` type for dateOfBirth, issueDate, expiryDate
- ✅ `tel` type for mobileNumber
- ✅ `email` type for email
- ✅ `radio` type for gender, hasProjectReference
- ✅ `checkbox` type for consent
- ✅ `passportProcessed` visibility gate for director fields
- ✅ `projectFieldsVisible` visibility gate for project fields
- ✅ `activeTab === 'send'` visibility gate for consent
- ✅ Domain-prefixed labels ("Director first name", "Project county")
- ✅ `{prefix}.{section}.{field}` ID convention
- ✅ Skipped UI state (loading, modal, validation, animation)
- ✅ Skipped uncontrolled inputs
- ✅ `useRegisterTabSwitchAction` with typed tabs
- ✅ `useRegisterSubmitAction` with guard
- ✅ All `useRegisterUIAction` calls (except cancelDirector return string)
- ✅ Parameterized actions (deleteDirector, editDirector) with useCallback

## Migration plan

1. Replace 30 × `useRegisterFormField` → 1 × `useProgressiveFields('pin-reg', steps)`
2. Fix 9 × `text` → `select` with options arrays (extract to module-scope constants)
3. Fix 10 × `required: false` → `required: true`
4. Fix 3 × stale `coreIds` in server/voice-config.ts
5. Wrap `cancelDirector` handler to return descriptive string
