# Design: `@unctad-ai/voice-agent` Meta-Package

**Date:** 2026-03-25
**Status:** Approved

## Problem

Consuming projects (Sw*) install three separate `@unctad-ai/voice-agent-*` client packages. This causes:

1. **React duplication** — When npm resolves the three packages independently, transitive dependencies can install separate React copies, crashing the app with React error #310 ("Invalid hook call").
2. **Version drift** — Consumers can accidentally mix incompatible versions (e.g., `ui@5.3.0` with `core@5.2.6`), causing subtle bugs.
3. **Maintenance overhead** — The voice-agent-action and every consumer must template and coordinate three dependency entries.

Current workaround is `resolve.dedupe` in each consumer's vite.config.ts — a band-aid that doesn't prevent version drift.

## Solution

Create `@unctad-ai/voice-agent`, a **dependency-only meta-package** (no code) in the monorepo that:

- Declares the 3 client packages as `dependencies` (version-locked via `workspace:*`)
- Declares React, ReactDOM, and react-router as `peerDependencies`
- Is published alongside the other packages via changesets (same fixed-version group)

### What it contains

```
packages/voice-agent/
├── package.json
└── README.md
```

No `src/`, no `dist/`, no build step. Just a package.json.

### package.json

```json
{
  "name": "@unctad-ai/voice-agent",
  "version": "5.3.0",
  "description": "Meta-package for voice-agent-kit client packages",
  "license": "MIT",
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18",
    "react-router": ">=6"
  },
  "dependencies": {
    "@unctad-ai/voice-agent-core": "workspace:*",
    "@unctad-ai/voice-agent-ui": "workspace:*",
    "@unctad-ai/voice-agent-registries": "workspace:*"
  }
}
```

### What changes for consumers

**Before (3 deps):**
```json
{
  "@unctad-ai/voice-agent-core": "latest",
  "@unctad-ai/voice-agent-ui": "latest",
  "@unctad-ai/voice-agent-registries": "latest"
}
```

**After (1 dep):**
```json
{
  "@unctad-ai/voice-agent": "latest"
}
```

**Imports stay identical** — no code changes:
```ts
import { VoiceAgentProvider } from '@unctad-ai/voice-agent-ui';
import { useProgressiveFields } from '@unctad-ai/voice-agent-registries';
```

### What's excluded

`@unctad-ai/voice-agent-server` stays separate. It has heavy server-only deps (groq-sdk, ws, multer, sharp) and is installed in a separate Docker stage from `server/package.json`.

## Why this works

- **React dedup** — npm resolves all 3 client packages from a single dependency root, so React peer deps resolve to one copy.
- **Version lock** — The umbrella pins all 3 at the same release version. Consumers can't mix versions.
- **Zero breaking change** — Existing imports are unaffected. Only package.json changes.
- **Changeset integration** — Same fixed-version group means the umbrella version bumps with every release automatically.

## Migration

1. Create `packages/voice-agent/` with package.json
2. Add to pnpm-workspace.yaml
3. Add to changeset fixed-version group
4. Publish alongside next release
5. Update voice-agent-action to template `@unctad-ai/voice-agent` instead of 3 separate deps
6. Update Sw* projects (can be gradual — old 3-dep pattern still works)
