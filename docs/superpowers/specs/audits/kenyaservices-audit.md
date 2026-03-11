# Voice Agent Integration Audit — Kenyaservices

**Date:** 2026-03-11
**Branch:** voice-agent-refactor
**Components audited:** 15 files (4 application forms, 7 dashboard sub-sections, 4 dashboard settings/account)

## Summary

11 bugs found across 6 files. 3 are high severity.

## Findings

### PinRegistrationApplication.tsx

#### Bug 1: Uses useRegisterFormField instead of useProgressiveFields
- **Severity:** High
- **Check:** A1
- **Line(s):** 127-408 (30 individual useRegisterFormField calls)
- **Current:** 30 individual `useRegisterFormField({...})` calls
- **Correct:** Single `useProgressiveFields('pin-reg', steps)` call with step-based visibility

### FilmProductionApplication.tsx

#### Bug 2: Uses useRegisterFormField instead of useProgressiveFields
- **Severity:** High
- **Check:** A1
- **Line(s):** 44-97 (5 individual useRegisterFormField calls)
- **Current:** 5 individual `useRegisterFormField({...})` calls
- **Correct:** Single `useProgressiveFields('film', steps)` call

#### Bug 3: Generic label text
- **Severity:** Medium
- **Check:** A5
- **Line(s):** 49, 57, 81, 94
- **Current:** `'Declaration 1'`, `'Declaration 2'`, `'Know Import Method'`
- **Correct:** Domain-prefixed: `'Film declaration 1'`, `'Film declaration 2'`, `'Film import method knowledge'`

### server/voice-config.ts

#### Bug 4: Invalid hardcoded service IDs in recommendServices tool
- **Severity:** High
- **Check:** 3.2 (service ID cross-reference)
- **Line(s):** 87
- **Current:** `coreIds = ['company-registration', 'work-permit', 'investor-certificate']`
- **Correct:** `coreIds = ['register-company', 'request-work-permits', 'investment-certificate']`
- **Impact:** Tool silently fails to find core services for foreign investors

### DashboardPersonalInfo.tsx

#### Bug 5: Uses useRegisterFormField instead of useProgressiveFields
- **Severity:** Medium
- **Check:** A1
- **Line(s):** 36-92 (8 individual useRegisterFormField calls)
- **Current:** 8 individual `useRegisterFormField({...})` calls
- **Correct:** Single `useProgressiveFields('personal-info', steps)` call

#### Bug 6: Labels lack domain prefix
- **Severity:** Low
- **Check:** A5
- **Line(s):** 36-92
- **Current:** `'First name'`, `'Last name'`, `'Email'`, etc.
- **Correct:** `'Personal first name'`, `'Personal last name'`, `'Personal email'`, etc.

### DashboardAccount.tsx

#### Bug 7: Uses useRegisterFormField instead of useProgressiveFields
- **Severity:** Medium
- **Check:** A1
- **Line(s):** 36-92 (8 individual useRegisterFormField calls)
- **Current:** 8 individual `useRegisterFormField({...})` calls
- **Correct:** Single `useProgressiveFields('account', steps)` call

#### Bug 8: Labels lack domain prefix
- **Severity:** Low
- **Check:** A5
- **Line(s):** 36-92
- **Current:** `'First name'`, `'Last name'`, `'Email'`, etc.
- **Correct:** `'Account first name'`, `'Account last name'`, `'Account email'`, etc.

### DashboardSettings.tsx

#### Bug 9: Uses useRegisterFormField instead of useProgressiveFields
- **Severity:** Medium
- **Check:** A1
- **Line(s):** 12-20 (2 individual useRegisterFormField calls)
- **Current:** 2 individual `useRegisterFormField({...})` calls
- **Correct:** Single `useProgressiveFields('settings', steps)` call

#### Bug 10: Labels lack domain prefix
- **Severity:** Low
- **Check:** A5
- **Line(s):** 12-20
- **Current:** `'Application updates'`, `'Service announcements'`
- **Correct:** `'Settings application updates'`, `'Settings service announcements'`

## Correctly implemented

### Passing files (no bugs):
- **RegisterCompanyApplication.tsx** — uses `useProgressiveFields`, correct types/labels/visibility
- **EvaluateInvestmentApplication.tsx** — uses `useProgressiveFields`, correct types/labels/visibility
- **src/voice-config.ts** — routes, service refs, synonyms all correct
- **Dashboard.tsx** — `useRegisterTabSwitchAction` correctly configured
- **DashboardApplications.tsx** — UI action returns descriptive string
- **Visas.tsx** — `useRegisterViewModeAction` correctly configured
- **SocialSecurity.tsx** — `useRegisterViewModeAction` correctly configured
- **Taxes.tsx** — `useRegisterViewModeAction` correctly configured
- **Licenses.tsx** — `useRegisterViewModeAction` correctly configured
- **BusinessRegistry.tsx** — `useRegisterViewModeAction` correctly configured
- **Agreements.tsx** — `useRegisterViewModeAction` correctly configured

### Passing checks across bugged files:
- PinRegistrationApplication: A4 (ID convention), A7 (object setter `prev =>`), A9 (tab switch), A10 (submit action)
- FilmProductionApplication: A8 (UI actions), A10 (submit action)

## Migration plan

1. Fix server/voice-config.ts coreIds (high severity, 1-line fix)
2. Migrate PinRegistrationApplication.tsx to useProgressiveFields (high severity, complex)
3. Migrate FilmProductionApplication.tsx to useProgressiveFields + fix labels (high severity)
4. Migrate DashboardPersonalInfo.tsx to useProgressiveFields + fix labels (medium)
5. Migrate DashboardAccount.tsx to useProgressiveFields + fix labels (medium)
6. Migrate DashboardSettings.tsx to useProgressiveFields + fix labels (medium)
7. Verify build passes
