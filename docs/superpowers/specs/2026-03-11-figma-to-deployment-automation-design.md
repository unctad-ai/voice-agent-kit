# Figma-to-Deployment Automation Pipeline

**Date:** 2026-03-11
**Status:** Approved

## Problem

Deploying a Figma Make-generated React project with voice agent integration requires ~15 manual steps: adding server code, Docker templates, packages, SiteConfig extraction, form field registration, vite patches, and Coolify onboarding. Each new project repeats this work. Designer updates on `main` require manual re-integration.

## Constraints

- **Figma Make owns `main`** — it force-writes entire files, assumes sole ownership, does not sync back. We cannot write to `main`.
- **Voice agent integration must live on a `voice-agent` branch** — separate from designer's work.
- **`git merge main` into voice-agent fails** — voice-agent branches reformat files, upgrade deps, restructure code. Merge conflicts on every shared file.
- **Existing integrations (Kenya, Bhutan, Licenses) were done by Claude Code and are unreviewed** — may contain bugs (wrong types, stale IDs, incomplete field registration). Cannot be used as-is for reference.

## Solution: Reusable GitHub Action + Claude Code

### Architecture

Three components:

**1. `unctad-ai/voice-agent-action`** — Reusable composite GitHub Action
```
voice-agent-action/
├── action.yml
├── templates/           # Deterministic scaffolding
│   ├── server/
│   │   ├── Dockerfile
│   │   ├── index.ts
│   │   └── package.json.tmpl
│   ├── Dockerfile.frontend
│   ├── docker-compose.yml.tmpl
│   └── nginx.conf
├── prompts/
│   ├── initial-integration.md
│   └── incremental-update.md
├── golden-reference/    # Reviewed before/after example
│   ├── before.tsx       # Original component from main
│   └── after.tsx        # Correctly integrated component
└── scripts/
    ├── scaffold.sh
    ├── detect-changes.sh
    └── verify.sh
```

**2. Per-project workflow** (~15 lines in each consuming repo):
```yaml
name: Voice Agent Sync
on:
  push:
    branches: [main]
concurrency:
  group: voice-agent-sync
  cancel-in-progress: true
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: unctad-ai/voice-agent-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

**3. Per-project config** (`.voice-agent.yml` on main):
```yaml
copilot_name: "Kenya Assistant"
copilot_color: "#1B5E20"
domain: "kenya.singlewindow.dev"
description: "Kenya Trade Single Window services portal"
voice_agent_version: "^0.1.8"
auto_merge_incremental: true   # true: auto-push if verify passes. false: always create PR.
exclude_routes: ["/2", "/3", "/green", "/red", "/red2", "/home2", "/home3"]  # Omitted from voice-config.ts navigation targets
```

### Strategy: Always Rebuild from Main

No merging. On every push to `main`, the action rebuilds `voice-agent` from scratch:

1. Start from `main` HEAD
2. Apply deterministic scaffold (server/, Docker, nginx, packages, vite patches)
3. Claude Code: wrap App.tsx, generate voice-config.ts, integrate form fields
4. Preserve manual additions from old voice-agent branch (manifest tracking)
5. Docker build + tests
6. Force-update `voice-agent` branch
7. Initial: create PR for human review / Incremental: auto-push if verify passes
8. Coolify auto-deploys from `voice-agent` branch

### Two-Tier File Management

| Tier | Files | On rebuild |
|------|-------|-----------|
| **Auto-regenerated** | voice-config.ts, server/voice-config.ts, App.tsx wrapping, package.json deps, vite.config.ts patches | Always regenerated from current main |
| **Generated once, preserved** | Form component modifications (useProgressiveFields/useRegisterFormField hooks) | Copied from old voice-agent branch. If main changed the component → flag for review |

Tracked via `.voice-agent/manifest.yml` on the voice-agent branch:
```yaml
auto_generated:
  - src/voice-config.ts
  - server/voice-config.ts
  - server/index.ts
  - server/package.json
  - server/Dockerfile
  - Dockerfile.frontend
  - docker-compose.yml
  - nginx.conf
modified:
  - src/App.tsx
  - package.json
  - vite.config.ts
```

**Manual addition preservation mechanism:** Before force-updating `voice-agent`, the action:
1. Checks out the old `voice-agent` branch
2. Lists all files on `voice-agent` that don't exist on `main`
3. Excludes files in `auto_generated` and `modified` lists above
4. Remaining files = manual additions (custom components, extra routes, utilities)
5. Copies them into the new rebuild before committing

For Tier 2 (form components): the action compares each form component's hash on `main` vs. the last-seen hash stored in the manifest. If unchanged → copy the integrated version from old `voice-agent`. If changed → re-run Claude Code and flag in PR.

### Rollback

Before force-updating `voice-agent`, the action tags the current HEAD:
```
voice-agent-backup-2026-03-11-143022
```
If a rebuild breaks production, restore via: `git checkout voice-agent-backup-<timestamp>` and force-push. Coolify auto-deploys the rollback.

### Form Field Integration

Form integration uses a reference-driven approach:

1. **Golden reference** — One human-reviewed before/after example (Kenya PinRegistration) that demonstrates every pattern correctly.

2. **Claude Code prompt** includes the golden reference + the target component. Claude Code pattern-matches from the correct example.

3. **Patterns to apply** (from voice-agent-kit API contracts):
   - `useProgressiveFields` for ALL new form field registrations (canonical batched API — replaces individual `useRegisterFormField` calls)
   - `useRegisterUIAction` for non-field interactions (add/remove items, uploads)
   - `useRegisterTabSwitchAction` for tab navigation
   - `useRegisterSubmitAction` for form submission
   - `select` type with options for `<select>` elements (not `text`)
   - `tel`/`email`/`date` types matching input types
   - Domain-prefixed labels ("Director first name", not "First name")
   - `{prefix}.{section}.{field}` ID convention
   - `visible` from JSX tree walking + processing/loading guards
   - Object state → per-property with `prev =>` setter pattern
   - Skip uncontrolled inputs (no React state = no bind target)

4. **First run**: Claude Code generates ~90-95% correct, human reviews in PR.
5. **Subsequent runs**: Form component files preserved from old branch. Only re-generated if the designer changed the component on main (flagged for review).

### Golden Reference Specification

The golden reference is created by reviewing and perfecting ONE existing integration (Kenya PinRegistrationApplication). It must demonstrate:

- [ ] Every `useProgressiveFields` pattern (simple fields, object state, conditional visibility)
- [ ] Correct `select` type with proper options for `<select>` elements
- [ ] Correct `tel`/`email`/`date` types
- [ ] Domain-prefixed labels
- [ ] `{prefix}.{section}.{field}` ID convention
- [ ] `visible` conditions derived from JSX rendering guards + processing guards
- [ ] Object state with `prev =>` setter pattern
- [ ] `useRegisterUIAction` for add/remove/upload operations with descriptive return strings
- [ ] `useRegisterTabSwitchAction` for tab navigation
- [ ] `useRegisterSubmitAction` with guard function
- [ ] Correctly skipped UI state (loading, modal, validation, animation state)
- [ ] Correctly skipped uncontrolled inputs

### Incremental Update Flow

When `voice-agent` branch already exists:

1. Detect what changed on main (diff previous..current):
   - `src/data/services.ts` changed → regenerate voice-config.ts
   - `App.tsx` routes changed → regenerate voice-config.ts navigation targets
   - Form component changed → flag for review (re-run Claude Code on that component)
   - Only styles/assets → cosmetic, skip Claude Code entirely
2. **Content hash check**: Before invoking Claude Code, hash the files it would read (services.ts, App.tsx, form components). If the content hash matches the previous run (stored in `.voice-agent/content-hash`), skip Claude Code even if `detect-changes.sh` classified the files as changed.
3. Rebuild from main HEAD (same as initial, but with preservation)
4. **Tree hash comparison**: Before force-pushing, compare the generated tree hash against the existing `voice-agent` branch. If identical (e.g., cosmetic-only changes that don't affect the voice overlay), skip the push entirely — avoids unnecessary Coolify redeployments.
5. If verify passes → auto-push to voice-agent
6. If verify fails → create PR for human review

### Authentication

Uses `CLAUDE_CODE_OAUTH_TOKEN` (Claude Code subscription) — not per-API-call billing.
The per-project workflow calls `unctad-ai/voice-agent-action@v1`, which internally wraps `anthropics/claude-code-action@v1` and passes the token through.

### Deployment

Coolify auto-deploys from `voice-agent` branch. No deployment action needed — the push triggers it.

## Migration

Existing projects (Kenya/Swkenya, Bhutan/Swbhutan, South Africa/Swsouthafrica, Lesotho/Swlesotho) need:
1. ~~Standardize branch name to `voice-agent`~~ (DONE — all repos renamed and branches standardized)
2. Add `.voice-agent.yml` to `main` branch
3. Add `.github/workflows/voice-agent-sync.yml` to `main` branch
4. Review and fix existing form integrations using golden reference patterns

## Risks

| Risk | Mitigation |
|------|-----------|
| Claude Code form extraction < 90% | Golden reference + human review on initial PR. Corrections persist. |
| Designer deletes `.voice-agent.yml` | Figma Make only writes files it generated — won't touch unknown files |
| Concurrent pushes race condition | `concurrency: cancel-in-progress: true` |
| Docker build slow in CI | Docker layer caching with buildx |
| Template version drift | `voice_agent_version` in `.voice-agent.yml`, action reads dynamically |
| Auto-deploy of broken code | Verify (build + tests) before push. On failure → PR instead of auto-push |
| Subtle regression passes verify | Backup tag before force-push enables quick rollback |
| extraServerTools lost on rebuild | server/voice-config.ts with custom tools tracked as Tier 2 (preserved, not regenerated) |
| Claude Code cost at scale (5-15 repos) | Content hash check skips Claude Code when input files unchanged. Tree hash check skips push when output unchanged. |
| Persona data lost on redeploy | `persona-data` Docker volume persists agent persona config across redeployments |
