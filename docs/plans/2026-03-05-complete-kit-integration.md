# Complete Voice-Agent-Kit Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete voice-agent-kit integration across all 3 consuming projects — add registry hooks to License Portal, and fully migrate Bhutan from CopilotKit to the published kit.

**Architecture:** Each project uses the same pattern: `VoiceAgentProvider` wraps the app with a `SiteConfig`, `GlassCopilotPanel` is lazy-loaded as a floating UI, forms register their fields via `useProgressiveFields`/`useRegisterFormField`, and the server uses `createVoiceRoutes` from `@unctad-ai/voice-agent-server`.

**Tech Stack:** React 18+, @unctad-ai/voice-agent-{core,ui,registries,server}, Express 5, TypeScript, Vite

**Reference implementation:** `/Users/moulaymehdi/PROJECTS/figma/Kenyaservices` — all patterns come from here.

---

## Workstream A: License Portal — Registry Hooks

### Task A1: Add useProgressiveFields to RegisterCompanyForm

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo/src/components/RegisterCompanyForm.tsx`

**Step 1: Add imports**

At the top of RegisterCompanyForm.tsx, add:
```tsx
import { useProgressiveFields, useRegisterTabSwitchAction } from '@unctad-ai/voice-agent-registries';
import type { FormFieldOption } from '@unctad-ai/voice-agent-registries';
```

**Step 2: Define option constants**

Before the component function, define FormFieldOption arrays for all radio/select fields (applicantCapacity, nationality, gender, proposedNameTab, etc). Pattern:
```tsx
const CAPACITY_OPTS: FormFieldOption[] = [
  { value: 'director', label: 'Director of the company' },
  { value: 'shareholder', label: 'Shareholder' },
  // ... match the options already in the form's JSX
];
```

**Step 3: Add useProgressiveFields call**

Inside the component, after state declarations but before any useEffect, add:
```tsx
useProgressiveFields('register-company', [
  {
    step: 'Applicant information',
    visible: activeSection === 'applicant',
    fields: [
      { id: 'firstName', label: 'First name', type: 'text', bind: [firstName, setFirstName] },
      { id: 'middleName', label: 'Middle name', type: 'text', bind: [middleName, setMiddleName] },
      { id: 'lastName', label: 'Last name', type: 'text', bind: [lastName, setLastName] },
      { id: 'nationality', label: 'Nationality', type: 'select', options: NATIONALITY_OPTS, bind: [nationality, setNationality] },
      { id: 'gender', label: 'Gender', type: 'radio', options: GENDER_OPTS, bind: [gender, setGender] },
      { id: 'phoneNumber', label: 'Phone number', type: 'text', bind: [phoneNumber, setPhoneNumber] },
      { id: 'emailAddress', label: 'Email address', type: 'text', bind: [emailAddress, setEmailAddress] },
    ],
  },
  // ... one step per form section, binding all fields
]);
```

Map ALL form sections (applicant, name, mother-company, company, owners, directors, incorporation-documents) to progressive steps. Each step's `visible` should match the `activeSection` state.

**Step 4: Add tab switch action**

```tsx
useRegisterTabSwitchAction(
  'register-company',
  ['applicant', 'name', 'mother-company', 'company', 'owners', 'directors', 'incorporation-documents'] as const,
  (tab) => setActiveSection(tab),
  'register-company'
);
```

**Step 5: Build and verify**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo && npx vite build`
Expected: Build succeeds

**Step 6: Commit**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo
git add src/components/RegisterCompanyForm.tsx
git commit -m "feat: add voice registry hooks to RegisterCompanyForm"
```

---

### Task A2: Add useProgressiveFields to PinRegistrationApplication

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo/src/components/PinRegistrationApplication.tsx`

**Step 1: Add imports**

```tsx
import { useProgressiveFields, useRegisterTabSwitchAction } from '@unctad-ai/voice-agent-registries';
import type { FormFieldOption } from '@unctad-ai/voice-agent-registries';
```

**Step 2: Add useProgressiveFields**

Register director fields and project fields as progressive steps:
```tsx
useProgressiveFields('pin-registration', [
  {
    step: 'Director information',
    visible: activeTab === 'form',
    fields: [
      { id: 'director.firstName', label: 'First name', type: 'text', bind: [currentDirector.firstName, (v) => updateDirector('firstName', v)] },
      { id: 'director.lastName', label: 'Last name', type: 'text', bind: [currentDirector.lastName, (v) => updateDirector('lastName', v)] },
      // ... all director fields
    ],
  },
  {
    step: 'Project details',
    visible: activeTab === 'form',
    fields: [
      { id: 'projectName', label: 'Project name', type: 'text', bind: [projectName, setProjectName] },
      { id: 'projectAddress', label: 'Project address', type: 'text', bind: [projectAddress, setProjectAddress] },
      // ... all project fields
    ],
  },
]);
```

**Step 3: Add tab switch action**

```tsx
useRegisterTabSwitchAction(
  'pin-registration',
  ['form', 'send'] as const,
  (tab) => setActiveTab(tab),
  'pin-registration'
);
```

**Step 4: Build and verify**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo && npx vite build`

**Step 5: Commit**

```bash
git add src/components/PinRegistrationApplication.tsx
git commit -m "feat: add voice registry hooks to PinRegistrationApplication"
```

---

### Task A3: Add useProgressiveFields to DeveloperAgreementForm

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo/src/components/DeveloperAgreementForm.tsx`

**Step 1-5:** Same pattern as A1/A2. Register fields for each tab:
- ProjectOverviewTab: zone identity, location, land status fields
- DeveloperTab: company info, authorized rep, ownership, financials
- MasterPlanTab, BusinessPlanTab, ComplianceTab fields

Use `useProgressiveFields('developer-agreement', [...])` and `useRegisterTabSwitchAction` for tab navigation.

**Step 6: Build and verify, commit**

```bash
git add src/components/DeveloperAgreementForm.tsx
git commit -m "feat: add voice registry hooks to DeveloperAgreementForm"
```

---

### Task A4: Add navigation actions to Dashboard

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo/src/components/Dashboard.tsx`

**Step 1: Add imports**

```tsx
import { useRegisterUIAction } from '@unctad-ai/voice-agent-registries';
import { useNavigate } from 'react-router';
```

**Step 2: Register navigation actions**

```tsx
const navigate = useNavigate();

useRegisterUIAction({
  id: 'navigate-home',
  label: 'Go to homepage',
  category: 'navigation',
  handler: () => navigate('/'),
});
useRegisterUIAction({
  id: 'navigate-new-application',
  label: 'Browse services',
  category: 'navigation',
  handler: () => navigate('/new-application'),
});
useRegisterUIAction({
  id: 'navigate-license-finder',
  label: 'Find a license',
  category: 'navigation',
  handler: () => navigate('/license-finder'),
});
```

**Step 3: Build, verify, commit**

```bash
git add src/components/Dashboard.tsx
git commit -m "feat: add voice navigation actions to Dashboard"
```

---

## Workstream B: Bhutan — Client Migration

### Task B1: Update Bhutan client dependencies

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/package.json`

**Step 1: Remove CopilotKit, add voice-agent-kit packages**

Remove from dependencies:
- `@copilotkit/react-core`
- `@copilotkit/react-ui`

Add to dependencies:
```json
"@unctad-ai/voice-agent-core": "^0.1.2",
"@unctad-ai/voice-agent-ui": "^0.1.2",
"@unctad-ai/voice-agent-registries": "^0.1.2"
```

Ensure peer deps exist: `motion`, `lucide-react`, `simplex-noise`, `react`, `react-dom`

**Step 2: Install**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto && npm install --legacy-peer-deps`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: replace CopilotKit with voice-agent-kit packages"
```

---

### Task B2: Create Bhutan voice-config.ts

**Files:**
- Create: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/voice-config.ts`

**Step 1: Create SiteConfig**

```tsx
import type { SiteConfig } from '@unctad-ai/voice-agent-core';
import { serviceCategories } from './data/services';

const allServices = serviceCategories.flatMap((c) => c.services);

export const bhutanSiteConfig: SiteConfig = {
  copilotName: 'Tashi',
  siteTitle: 'Bhutan ePhyto Portal',
  farewellMessage: 'Tashi delek! Feel free to come back anytime.',
  systemPromptIntro: 'You help users navigate phytosanitary services, export certificates, and import permits for agricultural trade in Bhutan.',

  avatarUrl: '/tashi-portrait.png',

  colors: {
    primary: '#E8762C',
    processing: '#F59E0B',
    speaking: '#14B8A6',
    glow: '#F59745',
    error: '#DC2626',
  },

  services: allServices,
  categories: serviceCategories,
  synonyms: {
    // Map Bhutan trade terms
    cardamom: ['spice', 'large cardamom'],
    ginger: ['spice', 'organic ginger'],
    apple: ['fruit', 'apple'],
    potato: ['vegetable', 'potato seed'],
    cordyceps: ['yartsa gunbu', 'caterpillar fungus'],
    timber: ['wood', 'forestry', 'lumber'],
    certificate: ['phytosanitary', 'phyto', 'SPS'],
    import: ['import permit', 'quarantine'],
    export: ['export certificate', 'phyto certificate'],
    inspection: ['pest inspection', 'fumigation', 'treatment'],
  },
  categoryMap: {
    export: 'Phytosanitary Certificates',
    import: 'Import Permits',
    inspection: 'Inspection & Treatment',
  },
  routeMap: {
    home: '/',
    dashboard: '/dashboard',
    ephyto: '/dashboard/ephyto',
    services: '/dashboard/services',
    applications: '/dashboard/applications',
    account: '/dashboard/account',
    settings: '/dashboard/settings',
  },
  getServiceFormRoute: (serviceId: string) => {
    const formRoutes: Record<string, string> = {
      'export-phyto-certificate': '/dashboard/ephyto',
      'register-company': '/dashboard/register-company',
      'film-production-permit': '/dashboard/film-production',
      'pin-registration': '/dashboard/pin-registration',
      'evaluate-investment-journey': '/dashboard/evaluate-investment',
    };
    return formRoutes[serviceId] || null;
  },
};
```

Adjust colors, synonyms, and route mappings based on the actual Bhutan data/services.ts content and existing routes in App.tsx.

**Step 2: Commit**

```bash
git add src/voice-config.ts
git commit -m "feat: add Bhutan SiteConfig for voice-agent-kit"
```

---

### Task B3: Delete custom voice components and rewrite App.tsx

**Files:**
- Delete: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/components/voice/` (entire directory)
- Delete: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/config/voiceAgent.ts`
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/App.tsx`

**Step 1: Delete custom voice components**

```bash
rm -rf /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/components/voice/
rm -f /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/config/voiceAgent.ts
```

**Step 2: Rewrite App.tsx imports**

Remove all CopilotKit and custom voice imports. Replace with:
```tsx
import { VoiceAgentProvider, VoiceOnboarding, VoiceA11yAnnouncer } from '@unctad-ai/voice-agent-ui';
import type { OrbState } from '@unctad-ai/voice-agent-core';
import { bhutanSiteConfig } from './voice-config';

const GlassCopilotPanel = lazy(() =>
  import('@unctad-ai/voice-agent-ui').then(m => ({ default: m.GlassCopilotPanel }))
);
```

**Step 3: Rewrite App component**

Replace CopilotProvider with VoiceAgentProvider. Keep all existing routes. Wire voice UI:
```tsx
export default function App() {
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>('idle');

  const toggleVoice = useCallback(() => setIsVoiceOpen(prev => !prev), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'V') { e.preventDefault(); toggleVoice(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleVoice]);

  return (
    <Router>
      <VoiceAgentProvider config={bhutanSiteConfig}>
        <ScrollToTop />
        <div className="min-h-screen" style={{ backgroundColor: '#FFFFFF' }}>
          <Routes>
            {/* ... keep ALL existing routes exactly as they are ... */}
          </Routes>
          {!isVoiceOpen && <VoiceOnboarding onTryNow={() => setIsVoiceOpen(true)} />}
          <Suspense fallback={null}>
            <GlassCopilotPanel
              isOpen={isVoiceOpen}
              onOpen={() => setIsVoiceOpen(true)}
              onClose={() => setIsVoiceOpen(false)}
              onStateChange={setOrbState}
            />
          </Suspense>
          <VoiceA11yAnnouncer isOpen={isVoiceOpen} orbState={orbState} />
        </div>
      </VoiceAgentProvider>
    </Router>
  );
}
```

**Step 4: Remove any other CopilotKit imports across the codebase**

Search for remaining `@copilotkit` or `CopilotProvider` or `useCopilotAction` or `useCopilotReadable` imports in `src/` and remove them. Check:
- Any component that imported from `../components/voice/`
- Any hook files that used CopilotKit
- VoiceSettingsProvider/Context if custom

**Step 5: Build and verify**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto && npx vite build`

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: migrate Bhutan client from CopilotKit to voice-agent-kit"
```

---

### Task B4: Add registry hooks to Bhutan forms

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/components/RegisterCompanyApplication.tsx`
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/components/FilmProductionApplication.tsx`
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/components/PinRegistrationApplication.tsx`
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/src/components/EvaluateInvestmentApplication.tsx`

For each form:

**Step 1: Add imports**
```tsx
import { useProgressiveFields, useRegisterTabSwitchAction } from '@unctad-ai/voice-agent-registries';
import type { FormFieldOption } from '@unctad-ai/voice-agent-registries';
```

**Step 2: Add useProgressiveFields**

Map all form fields to progressive steps following the Kenya pattern. Each step corresponds to a form section/tab, with `visible` tied to the active tab state.

**Step 3: Add useRegisterTabSwitchAction**

Register tab navigation for each form's tabs.

**Step 4: Build and verify, commit**

```bash
git add src/components/RegisterCompanyApplication.tsx src/components/FilmProductionApplication.tsx src/components/PinRegistrationApplication.tsx src/components/EvaluateInvestmentApplication.tsx
git commit -m "feat: add voice registry hooks to Bhutan form components"
```

---

## Workstream C: Bhutan — Server Migration

### Task C1: Update Bhutan server dependencies

**Files:**
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/server/package.json`

**Step 1: Remove CopilotKit, add voice-agent-kit**

Remove: `@copilotkit/runtime`

Add:
```json
"@unctad-ai/voice-agent-core": "^0.1.2",
"@unctad-ai/voice-agent-server": "^0.1.2"
```

**Step 2: Install**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/server && npm install --legacy-peer-deps`

**Step 3: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: replace CopilotKit runtime with voice-agent-server"
```

---

### Task C2: Create Bhutan server voice-config and rewrite index.ts

**Files:**
- Create: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/server/voice-config.ts`
- Modify: `/Users/moulaymehdi/PROJECTS/figma/Bhutanephyto/server/index.ts`

**Step 1: Create server voice-config.ts**

Copy the SiteConfig from the client-side voice-config.ts but adapted for server (ESM imports):
```tsx
import type { SiteConfig } from '@unctad-ai/voice-agent-core';
// Import services data — adjust path based on Bhutan's data location relative to server/
// May need to re-export or inline the service data
```

**Step 2: Rewrite server/index.ts**

Use Kenya's server/index.ts as the template. Replace all CopilotKit runtime code with:
```tsx
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { createVoiceRoutes } from '@unctad-ai/voice-agent-server';
import { bhutanSiteConfig } from './voice-config.js';

const voice = createVoiceRoutes({
  config: bhutanSiteConfig,
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL,
  sttProvider: process.env.STT_PROVIDER,
  kyutaiSttUrl: process.env.KYUTAI_STT_URL,
  ttsProvider: process.env.TTS_PROVIDER,
  qwen3TtsUrl: process.env.QWEN3_TTS_URL,
  chatterboxTurboUrl: process.env.CHATTERBOX_TURBO_URL,
  cosyVoiceTtsUrl: process.env.COSYVOICE_TTS_URL,
  pocketTtsUrl: process.env.POCKET_TTS_URL,
  resembleApiKey: process.env.RESEMBLE_API_KEY,
  resembleModel: process.env.RESEMBLE_MODEL,
  resembleVoiceUuid: process.env.RESEMBLE_VOICE_UUID,
});

// ... rest follows Kenya pattern exactly (cors, rate limiter, API key auth, routes, health check)
```

**Step 3: Build and verify**

Run: `cd /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto && npx vite build`

**Step 4: Commit**

```bash
git add server/
git commit -m "feat: migrate Bhutan server to voice-agent-kit createVoiceRoutes"
```

---

## Workstream D: Final Verification

### Task D1: Docker builds

**Step 1: Build all Docker images**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo && docker compose build --no-cache
cd /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto && docker compose build --no-cache
```

**Step 2: Fix any build failures**

If Bhutan's Dockerfile still references voice-agent-kit source via COPY/sed, simplify it (packages come from npm now).

**Step 3: Commit any fixes**

---

## Swarm Assignment

| Agent | Tasks | Project Directory |
|-------|-------|-------------------|
| license-registries | A1, A2, A3, A4 | /Users/moulaymehdi/PROJECTS/figma/Licenseportaldemo |
| bhutan-client | B1, B2, B3, B4 | /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto |
| bhutan-server | C1, C2 | /Users/moulaymehdi/PROJECTS/figma/Bhutanephyto |

**Dependencies:** bhutan-server (C1, C2) should start after B1 (client deps) to avoid package.json conflicts. license-registries is fully independent.

**Verification (D1)** runs after all agents complete.
