# Voice Agent Integration Audit — Licenseportaldemo

**Date:** 2026-03-11
**Branch:** voice-agent
**Components audited:** PinRegistrationApplication.tsx, RegisterCompanyForm.tsx, DeveloperAgreementForm.tsx, Dashboard.tsx

## Summary

21 bugs found across 4 files. 7 are high severity, 10 medium, 4 low.

## Findings

### Dashboard.tsx

#### Bug 1: Should use useRegisterTabSwitchAction
- **Severity:** Medium
- **Check:** 2.9
- **Line(s):** 16-30
- **Current:** Manual `useRegisterUIAction('dashboard.navigate', ...)` with params-based section switching
- **Correct:** `useRegisterTabSwitchAction('dashboard', validSections, setActiveTab, 'dashboard')`

### PinRegistrationApplication.tsx

#### Bug 2: queryProjectData handler returns void
- **Severity:** High
- **Check:** 2.8
- **Line(s):** 288-292, 367-401
- **Current:** `handleQueryProjectData` is async and returns void/undefined
- **Correct:** Wrap handler to return a descriptive string

#### Bug 3: project.nationality missing required: true
- **Severity:** Medium
- **Check:** 2.3
- **Line(s):** 179
- **Current:** No `required: true`
- **Correct:** Add `required: true` (JSX label has red asterisk)

#### Bug 4: project.amount missing required: true
- **Severity:** Medium
- **Check:** 2.3
- **Line(s):** 180
- **Current:** No `required: true`
- **Correct:** Add `required: true` (JSX label has red asterisk)

#### Bug 5: Stale closure in JSX onChange handlers
- **Severity:** Medium
- **Check:** 2.7
- **Line(s):** 771,785,796,812,836,866,877,894,918,944,960,983,997,1007,1034,1056,1072
- **Current:** `setCurrentDirector({ ...currentDirector, field: v })` in JSX onChange
- **Correct:** `setCurrentDirector(prev => ({ ...prev, field: v as string }))`

#### Bugs 6-8: input type="number" mapped to 'text'
- **Severity:** Low
- **Check:** 2.2
- **Current:** type: 'text' for number inputs (amount, localStaff, foreignStaff)
- **Correct:** Acceptable — no 'number' FormFieldType exists

### DeveloperAgreementForm.tsx

#### Bug 9: Missing steps for master-plan, business-plan, compliance tabs
- **Severity:** High
- **Check:** 2.2/2.6
- **Line(s):** 235-299
- **Current:** Only 2 steps registered (developer-info, project-overview)
- **Correct:** Should have steps for all data-entry tabs

#### Bug 10: Missing field existingZoneName
- **Severity:** Medium
- **Check:** 2.2
- **Current:** Not registered in useProgressiveFields
- **Correct:** Add conditional field visible when `zoneType === 'existing'`

#### Bug 11: Missing field otherActivity
- **Severity:** Medium
- **Check:** 2.2
- **Current:** Not registered
- **Correct:** Add conditional field visible when proposedActivities includes 'other'

#### Bug 12: Missing field taxComplianceExplanation
- **Severity:** Medium
- **Check:** 2.2
- **Current:** Not registered
- **Correct:** Add conditional field visible when taxCompliantStatus relevant

#### Bug 13: taxCompliantStatus likely wrong type
- **Severity:** Medium
- **Check:** 2.2
- **Current:** type: 'text'
- **Correct:** Needs JSX verification — may be 'radio' with yes/no options

#### Bug 14: No required flags on any field
- **Severity:** Medium
- **Check:** 2.3
- **Current:** Zero fields have required: true
- **Correct:** Core fields should have required: true per JSX markers

#### Bug 15: No UI actions registered
- **Severity:** Low
- **Check:** 2.8
- **Current:** No useRegisterUIAction calls
- **Correct:** Consider registering Previous/Next navigation actions

### RegisterCompanyForm.tsx

#### Bug 16: Mother company step missing visibility gate
- **Severity:** High
- **Check:** 2.6
- **Line(s):** 576
- **Current:** `visible: activeFormSection === 'mother-company'`
- **Correct:** `visible: activeFormSection === 'mother-company' && companyType === 'branch-foreign'`

#### Bug 17: sp.town type mismatch
- **Severity:** High
- **Check:** 2.2
- **Line(s):** 661
- **Current:** type: 'text'
- **Correct:** type: 'select' with town options from JSX

#### Bug 18: Mother company missing 2 fields
- **Severity:** High
- **Check:** 2.2
- **Line(s):** 577-588
- **Current:** motherCompanyCountry and motherCompanyCapitalCurrency not registered
- **Correct:** Add both as type: 'select' with options

#### Bug 19: Owner step missing 11+ fields
- **Severity:** High
- **Check:** 2.2
- **Line(s):** 612-626
- **Current:** Many owner fields not registered (nationality, typeOfCompany, registrationDate, county, district, locality, country, city, shareholderName, value, effectiveDate)
- **Correct:** Register each with correct types per JSX

#### Bug 20: Director step missing 6+ fields
- **Severity:** High
- **Check:** 2.2
- **Line(s):** 629-644
- **Current:** Missing directorNationality, directorTypeOfPerson, directorTypeOfCompany, directorCompanyName, directorCompanyRegistrationNumber, directorRegistrationDate
- **Correct:** Register each per JSX

#### Bug 21: Director conditional fields lack visibility
- **Severity:** Medium
- **Check:** 2.6
- **Line(s):** 639-640
- **Current:** director.nationalIdNumber and director.passportNumber always visible
- **Correct:** Add visibility: directorIdType === 'national-id' / 'passport'

#### Bug 22: director.function options mismatch
- **Severity:** Medium
- **Check:** 2.2
- **Line(s):** 632
- **Current:** DIRECTOR_FUNCTION_OPTS has 2 options
- **Correct:** Should have 4 options matching JSX Select

#### Bug 23: SP step missing 2 fields
- **Severity:** Medium
- **Check:** 2.2
- **Line(s):** 654-667
- **Current:** spDistrict and spPhoneCode not registered
- **Correct:** Add both as type: 'select'

#### Bug 24: No UI actions registered
- **Severity:** Medium
- **Check:** 2.8
- **Current:** No useRegisterUIAction calls
- **Correct:** Register actions for Check Availability, Add Director, Save Director

### voice-config.ts

No bugs found. Service IDs match services data. Route maps are correct. Configs in sync.

## Correctly implemented

- All 4 components use `useProgressiveFields` (batched API)
- All form components use `useRegisterTabSwitchAction` correctly
- All form components use `useRegisterSubmitAction` with guards
- ID convention follows `{section}.{field}` camelCase pattern
- Labels are domain-prefixed across all components
- Object state setters in voice-agent bind use `prev =>` pattern
- File uploads, arrays, loading indicators correctly NOT registered as fields
- Voice-config service IDs match actual services data

## Migration plan

1. Fix Dashboard.tsx — replace manual navigate action with useRegisterTabSwitchAction
2. Fix PinRegistrationApplication.tsx — fix queryProjectData handler, add required flags, fix stale closures
3. Fix DeveloperAgreementForm.tsx — add missing fields/steps, fix types, add required flags
4. Fix RegisterCompanyForm.tsx — fix visibility, fix types, add missing fields, add UI actions
