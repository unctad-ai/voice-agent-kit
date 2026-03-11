# Voice Agent Integration Audit — Bhutanephyto

**Date:** 2026-03-11
**Branch:** feat/multi-voice-support
**Components audited:** PinRegistrationApplication, FilmProductionApplication, RegisterCompanyApplication, EvaluateInvestmentApplication

## Summary

27 bugs found across 3 files (PinRegistration, FilmProduction, RegisterCompany). 11 are high severity (wrong field types, missing visibility, unregistered fields). EvaluateInvestmentApplication passes all checks.

## Findings

### PinRegistrationApplication.tsx

#### Bug 1: Select fields registered as text
- **Severity:** High
- **Check:** 2.2 (Field type correctness)
- **Line(s):** 146, 152, 164
- **Current:** `projectSector`, `projectActivity`, `projectNationality` registered as `type: 'text'`
- **Correct:** `type: 'select'` with `options` arrays extracted from JSX `<select>` elements

#### Bug 2: Missing select field registrations
- **Severity:** High
- **Check:** 2.2 (Field type correctness)
- **Line(s):** JSX lines 1153, 1173 (select elements not in useProgressiveFields)
- **Current:** `projectCounty`, `projectSubCounty` are `<select>` elements in JSX but not registered
- **Correct:** Add these fields to useProgressiveFields with `type: 'select'` and options

#### Bug 3: Missing required flags
- **Severity:** Medium
- **Check:** 2.3 (Required flags)
- **Line(s):** 110-190 (all fields in useProgressiveFields)
- **Current:** No fields have `required: true`
- **Correct:** Fields with `*` markers in JSX should have `required: true`: projectName, projectSector, projectActivity, projectDescription, projectNationality, projectAmount, hasProjectReference

#### Bug 4: Labels not domain-prefixed
- **Severity:** Low
- **Check:** 2.5 (Label convention)
- **Line(s):** 148, 154, 160, 166
- **Current:** "Sector", "Activity", "Description", "Nationality"
- **Correct:** "Project sector", "Project activity", "Project description", "Business nationality"

#### Bug 5: Consent step wrong visibility
- **Severity:** High
- **Check:** 2.6 (Visibility conditions)
- **Line(s):** 190
- **Current:** `visible: activeTab === 'form'`
- **Correct:** `visible: activeTab === 'send'` (consent JSX renders on send tab)

#### Bug 6: Select options not extracted to module scope
- **Severity:** Medium
- **Check:** 2.2 / module-scope pattern
- **Line(s):** JSX lines 757-764, 839-846, 927-931, 1160-1164, 1214-1220, 1277-1281
- **Current:** Options defined inline in JSX `<option>` elements, not in field configs
- **Correct:** Extract to `const X_OPTS: FormFieldOption[] = [...]` at module scope, include in field config

### FilmProductionApplication.tsx

#### Bug 7: Missing required flags on declarations
- **Severity:** Medium
- **Check:** 2.3 (Required flags)
- **Line(s):** 84-94
- **Current:** `declaration1`, `declaration2` lack `required: true`
- **Correct:** Both should have `required: true` (submit is disabled unless both checked)

#### Bug 8: Declarations step wrong visibility
- **Severity:** High
- **Check:** 2.6 (Visibility conditions)
- **Line(s):** 81
- **Current:** `visible: activeTab === 'form' && currentFormPage === 'activities'`
- **Correct:** `visible: activeTab === 'send'` (declarations JSX renders on send tab)

#### Bug 9: Missing submit action
- **Severity:** Medium
- **Check:** 2.10 (Submit action)
- **Current:** No `useRegisterSubmitAction` registered
- **Correct:** Should register submit action for the send button

#### Bug 10: Missing form page navigation action
- **Severity:** Medium
- **Check:** 2.8 (UI actions)
- **Current:** No action for navigating between form pages (project/applicant/personnel/equipment/activities)
- **Correct:** Should register a UI action for form page navigation

#### Bug 11: ~30 form fields completely unregistered
- **Severity:** High
- **Check:** 2.2 (Field type correctness)
- **Current:** Only 5 fields registered (importEquipment, knowImportMethod, equipmentEntryMethod, declaration1, declaration2). ~30 fields across project/applicant/personnel/equipment/activities pages are not registered.
- **Correct:** Register all form fields with correct types, labels, and visibility conditions

#### Bug 12: 4 select elements have no registered field configs
- **Severity:** Medium
- **Check:** 2.2 / 2.9
- **Line(s):** JSX ~277 (production type), ~352 (parishes), ~717 (shipping method), ~728 (port of entry)
- **Current:** Select elements in JSX but no corresponding registered fields
- **Correct:** Register with `type: 'select'` and extracted options

### RegisterCompanyApplication.tsx

#### Bug 13: commodityType wrong field type
- **Severity:** High
- **Check:** 2.2 (Field type correctness)
- **Line(s):** 119
- **Current:** `type: 'radio'` but JSX renders `<select>` at line 795
- **Correct:** `type: 'select'`

#### Bug 14: signatoryRole wrong field type
- **Severity:** High
- **Check:** 2.2 (Field type correctness)
- **Line(s):** 153
- **Current:** `type: 'text'` but JSX renders `<select>` at line 1107
- **Correct:** `type: 'select'` with options extracted from JSX

#### Bug 15: signatoryMobile wrong field type
- **Severity:** High
- **Check:** 2.2 (Field type correctness)
- **Line(s):** 158
- **Current:** `type: 'text'`
- **Correct:** `type: 'tel'`

#### Bug 16: signatoryEmail wrong field type
- **Severity:** High
- **Check:** 2.2 (Field type correctness)
- **Line(s):** 163
- **Current:** `type: 'text'`
- **Correct:** `type: 'email'`

#### Bug 17: Missing required flags
- **Severity:** Medium
- **Check:** 2.3 (Required flags)
- **Line(s):** 72, 79, 93, 145, 151, 157, 163, 168
- **Current:** 8 fields with JSX required markers (`*` or red dot) lack `required: true`
- **Correct:** Add `required: true` to: exporterType, individualType, cidNumber, signatoryFullName, signatoryRole, signatoryMobile, signatoryEmail, undertakingAgreed

#### Bug 18: Labels not domain-prefixed
- **Severity:** Low
- **Check:** 2.5 (Label convention)
- **Line(s):** 100, 107, 158, 164
- **Current:** "Full name", "Local address", "Mobile number", "Email address"
- **Correct:** "Exporter full name", "Exporter local address", "Signatory mobile number", "Signatory email address"

#### Bug 19: Exporter details step wrong visibility
- **Severity:** High
- **Check:** 2.6 (Visibility conditions)
- **Line(s):** 90
- **Current:** `visible: activeTab === 'form' && !!exporterType`
- **Correct:** `visible: activeTab === 'form' && !!individualType` (JSX renders when individualType is set)

#### Bug 20: commodityType options mismatch
- **Severity:** High
- **Check:** 2.9 (Select options)
- **Line(s):** 119 / JSX 795-812
- **Current:** `COMMODITY_TYPE_OPTS` has spices/fruits/vegetables/grains/medicinal/other
- **Correct:** Options should match JSX `<select>`: spices/cereals/fresh-fruits/dry-fruits/areca-nut/other

#### Bug 21: signatoryRole missing options
- **Severity:** High
- **Check:** 2.9 (Select options)
- **Line(s):** 153
- **Current:** No options (registered as text)
- **Correct:** Extract from JSX `<select>`: owner/director/manager/authorized-representative

### voice-config.ts / server/voice-config.ts

No bugs found. Both configs reference valid service IDs from `src/data/services.ts`. The `routeMap`, `synonyms`, and `categoryMap` entries are all correct.

## Correctly implemented

- All 4 components use `useProgressiveFields` (batched API) — no legacy `useRegisterFormField` calls
- `EvaluateInvestmentApplication` passes all 10 checks with clean implementation
- All components use `useRegisterTabSwitchAction` correctly
- Module-scope option constants pattern used in EvaluateInvestment and partially in RegisterCompany
- Object state setters use `prev => ({...prev})` pattern where applicable
- UI toggle/loading/array state correctly excluded from field registration
- Voice-config service IDs match `src/data/services.ts`

## Migration plan

1. **RegisterCompanyApplication**: Fix field types (commodityType→select, signatoryRole→select, signatoryMobile→tel, signatoryEmail→email), fix options mismatch, extract signatoryRole options, fix visibility, fix required flags, fix labels
2. **PinRegistrationApplication**: Fix field types (3 selects), extract 9 option arrays to module scope, add missing field registrations (county, sub-county), fix required flags, fix consent visibility, fix labels
3. **FilmProductionApplication**: Register ~30 missing fields across all form pages, fix declarations visibility, add required flags, extract select options, add submit action and form page navigation action
4. **Voice configs**: No changes needed
