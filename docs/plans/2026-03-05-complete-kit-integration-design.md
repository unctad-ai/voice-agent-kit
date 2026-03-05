# Complete Voice-Agent-Kit Integration

## Context

The voice-agent-kit monorepo publishes 4 packages (@unctad-ai/voice-agent-{core,ui,registries,server}). Three consuming projects need full integration:

- **Kenya** — fully integrated (reference implementation)
- **License Portal** — has UI + server, missing registry hooks on 3 large forms
- **Bhutan** — still on CopilotKit v1, needs full migration

## Workstream 1: License Portal — Registry Hooks

### Forms to wire

| Form Component | Approach | Field Count |
|----------------|----------|-------------|
| RegisterCompanyForm | useProgressiveFields (multi-step) | ~60 |
| PinRegistrationApplication | useProgressiveFields (multi-step) | ~30 |
| DeveloperAgreementForm | useProgressiveFields (multi-step) | ~80 |

### Navigation actions

Register via useRegisterUIAction on Dashboard:
- home, dashboard, license-finder, new-application, register-company, pin-registration

### Pattern

Follow Kenya's RegisterCompanyApplication.tsx and EvaluateInvestmentApplication.tsx as reference for:
- useProgressiveFields with service ID and step definitions
- useRegisterTabSwitchAction for tab navigation
- useRegisterSubmitAction for form submission

## Workstream 2: Bhutan — Full Migration

### Delete

- `src/components/voice/` — all custom voice components (~2000 lines)
- `src/config/voiceAgent.ts` — custom config (replaced by SiteConfig)
- All `@copilotkit/*` imports and hooks (useCopilotAction, useCopilotReadable, CopilotProvider)
- `@copilotkit/*` from package.json (root + server)

### Create

**Client:**
- `src/voice-config.ts` — SiteConfig for Tashi (copilotName: 'Tashi', ePhyto services, Bhutan green branding)
- Update `App.tsx` — VoiceAgentProvider, lazy GlassCopilotPanel, VoiceOnboarding, VoiceA11yAnnouncer
- Add `@unctad-ai/voice-agent-{core,ui,registries}` to package.json

**Server:**
- Rewrite `server/index.ts` — use createVoiceRoutes from @unctad-ai/voice-agent-server
- Create `server/voice-config.ts` — server-side SiteConfig
- Replace `@copilotkit/runtime` with `@unctad-ai/voice-agent-{core,server}` in server/package.json

**Registry hooks** on Bhutan forms:
- RegisterCompanyApplication
- FilmProductionApplication
- PinRegistrationApplication
- EvaluateInvestmentApplication
- DashboardEPhyto (if it has form fields)

### Preserve (do not touch)

- All page components, routes, data files
- ePhyto-specific pages and payment flows
- Service catalog (data/services.ts)
- Styling, Tailwind config, Radix UI components

## Swarm Plan

3 parallel agents:

| Agent | Project | Scope |
|-------|---------|-------|
| license-registries | Licenseportaldemo | Add registry hooks to 3 forms + navigation actions |
| bhutan-client | Bhutanephyto | Client migration: delete voice/, add kit packages, wire App.tsx, create voice-config, add registry hooks |
| bhutan-server | Bhutanephyto | Server migration: replace CopilotKit runtime with voice-agent-server, create voice routes |

## Success Criteria

- All 3 projects build successfully (vite build for client, tsc for server)
- All 3 projects have VoiceAgentProvider + GlassCopilotPanel wired
- All forms with >5 fields have useProgressiveFields or useRegisterFormField hooks
- No CopilotKit imports remain in Bhutan
- Docker builds pass for all 3 projects
