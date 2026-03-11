# Figma-to-Deployment Automation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the pipeline from Figma Make-generated React project → voice agent integration → Coolify deployment via a reusable GitHub Action.

**Architecture:** A composite GitHub Action (`unctad-ai/voice-agent-action`) wraps deterministic scaffolding (templates) + Claude Code (intelligent SiteConfig/form extraction). On every push to `main`, it rebuilds the `voice-agent` branch from scratch, preserving manual additions via manifest tracking. Coolify auto-deploys.

**Tech Stack:** GitHub Actions (composite), `anthropics/claude-code-action@v1`, Bash scripts, Docker, Node.js/TypeScript

**Spec:** `docs/superpowers/specs/2026-03-11-figma-to-deployment-automation-design.md` (in the voice-agent-kit repo)

---

## Background

### Why this exists
Designers use **Figma Make** to generate React/Vite projects and push to GitHub `main`. Our team then manually adds voice agent support (~15 steps). This plan automates that process.

### Key constraints
- **Figma Make owns `main`** — it force-writes entire files, doesn't sync back. We can never write to `main`.
- **`git merge` fails** — the voice-agent branch modifies shared files (App.tsx, package.json, vite.config.ts). Figma Make regenerates those same files. Merge conflicts every time.
- **Solution: always rebuild** — on every push to `main`, rebuild `voice-agent` from scratch (main + voice overlay). No merging.
- **Existing integrations are unreviewed Claude Code output** — may contain bugs. We create a "golden reference" first.

### What the voice-agent-kit provides
- `@unctad-ai/voice-agent-core` — React hooks (useVoiceAgent, useTenVAD)
- `@unctad-ai/voice-agent-registries` — Form field registration (useProgressiveFields, useRegisterUIAction)
- `@unctad-ai/voice-agent-ui` — React components (GlassCopilotPanel, VoiceOrb)
- `@unctad-ai/voice-agent-server` — Express route handlers (chat, STT, TTS)
- API docs: `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/packages/registries/src/useProgressiveFields.ts`

### Consuming projects
| Project | Repo | Main branch | Voice branch | Location |
|---------|------|-------------|-------------|----------|
| Kenya | unctad-ai/Swkenya | `main` (Figma Make) | `voice-agent` | `/Users/moulaymehdi/PROJECTS/figma/Swkenya` |
| Bhutan | unctad-ai/Swbhutan | `main` (Figma Make) | `voice-agent` | `/Users/moulaymehdi/PROJECTS/figma/Swbhutan` |
| South Africa | unctad-ai/Swsouthafrica | `main` (Figma Make) | `voice-agent` | `/Users/moulaymehdi/PROJECTS/figma/Swsouthafrica` |
| Lesotho | unctad-ai/Swlesotho | `main` (Figma Make) | — | `/Users/moulaymehdi/PROJECTS/figma/Swlesotho` |

### Deployment
All three deploy to `*.singlewindow.dev` via Coolify (self-hosted PaaS). Coolify watches the voice-agent branch and auto-deploys on push. Docker Compose: nginx frontend + Express backend. Traefik handles SSL.

---

## Prerequisites

1. **Repos cloned locally** at the paths listed above
2. **GitHub CLI (`gh`)** authenticated with access to `unctad-ai` org
3. **Voice-agent-kit repo** at `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit`
4. **Docker** installed locally (for verify step testing)
5. **`CLAUDE_CODE_OAUTH_TOKEN`** available (for GitHub Actions secrets)
6. **`yq`** installed (`brew install yq`) — used by the action to parse YAML config

---

## Chunk 1: Golden Reference

Create the human-reviewed, correct form integration example that all automation will pattern-match from. This is the foundation — everything in Chunks 2-4 depends on it.

**Working directory:** `/Users/moulaymehdi/PROJECTS/figma/Swkenya`

Create the human-reviewed, correct form integration example that all automation will pattern-match from. This is the foundation — everything in Chunks 2-4 depends on it.

**Working repo:** `/Users/moulaymehdi/PROJECTS/figma/Swkenya` (branch: `voice-agent`)

### Task 1: Audit existing Kenya PinRegistration integration

**Files:**
- Read: `src/components/PinRegistrationApplication.tsx` (on `voice-agent`)
- Read: `src/voice-config.ts` (on `voice-agent`)
- Read: `server/voice-config.ts` (on `voice-agent`)
- Create: `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference-audit.md`

- [ ] **Step 1: Read the current integration on voice-agent**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya
git show voice-agent:src/components/PinRegistrationApplication.tsx > /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/kenya-pin-current.tsx
```

- [ ] **Step 2: Read the original component on main for comparison**

```bash
git show main:src/components/PinRegistrationApplication.tsx > /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/kenya-pin-original.tsx
```

- [ ] **Step 3: Audit against API contracts**

Compare the current integration against these correctness criteria from the voice-agent-kit API:

| Criterion | Check |
|-----------|-------|
| Uses `useProgressiveFields` (not individual `useRegisterFormField`) | The canonical batched API |
| `select` type with options for `<select>` elements | Not `text` — FormFieldRegistry validates options |
| `tel`/`email`/`date` types matching `<input type="">` | Not generic `text` |
| Domain-prefixed labels ("Director first name") | Not just "First name" |
| `{prefix}.{section}.{field}` ID convention | Hierarchical grouping |
| `visible` from JSX tree walking + processing guards | Including `!isProcessingPassport` |
| Object state with `prev =>` setter | Not stale closure `{...obj}` |
| `useRegisterUIAction` for non-field interactions | With descriptive return strings |
| `useRegisterTabSwitchAction` for tabs | With typed tab array |
| `useRegisterSubmitAction` with guard | With error string return |
| Skips uncontrolled inputs (no useState) | Can't bind without state |
| Skips UI state (loading, modal, validation flags) | Not form fields |

- [ ] **Step 4: Audit voice-config.ts for stale service IDs**

```bash
git show voice-agent:server/voice-config.ts > /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/kenya-server-config.tsx
```

Check: do all service IDs referenced in `coreIds`, `routeMap`, and `getServiceFormRoute` match actual IDs in `src/data/services.ts`?

Known bug: `coreIds` contains `'company-registration'` and `'work-permit'` but actual IDs are `'register-company'` and `'request-work-permits'`.

- [ ] **Step 5: Document all bugs found**

Write findings to `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference-audit.md` with:
- Each bug: file, line, what's wrong, what's correct
- Missing registrations (fields that should be registered but aren't)
- Excess registrations (fields that shouldn't be registered)
- Wrong types, labels, IDs, visible conditions

### Task 2: Create the golden reference (corrected PinRegistration)

**Files:**
- Modify: `src/components/PinRegistrationApplication.tsx` (on a new branch `golden-reference`)
- Modify: `server/voice-config.ts`
- Reference: voice-agent-kit API at `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/packages/registries/src/useProgressiveFields.ts`
- Reference: voice-agent-kit API at `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/packages/registries/src/useRegisterUIAction.ts`

- [ ] **Step 1: Create working branch**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya
git checkout voice-agent
git checkout -b golden-reference
```

- [ ] **Step 2: Read the useProgressiveFields API**

```bash
cat /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/packages/registries/src/useProgressiveFields.ts
```

Understand the exact type signatures: `ProgressiveStepConfig`, `ProgressiveFieldConfig`, the `bind` tuple, `visible` semantics.

- [ ] **Step 3: Rewrite PinRegistration form hooks using useProgressiveFields**

Replace all individual `useRegisterFormField` calls with a single `useProgressiveFields` call. Follow these rules:

**ID convention:** `pin-reg.{section}.{fieldName}` where section is `director`, `project`, or `consent`.

**Step grouping:**
- Step "Project reference": visible = `showProjectReferenceSection`, fields = hasProjectReference radio
- Step "Project information": visible = `hasProjectReference === 'no' || projectDataQueried`, fields = all project fields
- Step "Director personal details": visible = `showDirectorForm && hasUploadedFile && !isProcessingPassport`, fields = all director fields from currentDirector
- Step "Consent": visible = `activeTab === 'send'`, fields = consentChecked checkbox

**Type rules:**
- `<select>` → type `select` with `options` array extracted to module-scope constants
- `<input type="tel">` → type `tel`
- `<input type="email">` → type `email`
- `<input type="date">` → type `date`
- `<textarea>` → type `text`

**Label rules:** Prefix with section context: "Director first name", "Director date of birth", "Project county", "Project investment amount (USD)".

**Setter rules for currentDirector (object state):**
```typescript
bind: [currentDirector.firstName, (v) => setCurrentDirector(prev => ({...prev, firstName: v as string}))]
```

**Skip:** All `useState` for UI state (activeTab, showDirectorForm, editingDirectorId, directors array, isProcessingPassport, hasUploadedFile, isImageLoading, showProjectReferenceSection, validationErrors, projectDataQueried, isQueryingProject, isInfoCardOpen). Skip `projectReference` text input (handled as UIAction).

- [ ] **Step 4: Add/fix useRegisterUIAction calls**

Each UIAction must have a descriptive return string:

```typescript
useRegisterUIAction(
  'pin-reg.addDirector',
  'Add a new director to the application',
  useCallback(() => {
    setShowDirectorForm(true);
    setEditingDirectorId(null);
    setCurrentDirector({...initialDirector});
    return `Director form opened. ${directors.length} director(s) already added.`;
  }, [directors.length]),
  { category: 'pin-reg' }
);
```

Actions to register: addDirector, saveDirector, cancelDirector, editDirector, deleteDirector, uploadPassport, deletePassport, setProjectReference, queryProjectData, validateForm.

- [ ] **Step 5: Add/fix useRegisterTabSwitchAction**

```typescript
useRegisterTabSwitchAction(
  'pin-reg',
  ['form', 'send'] as const,
  (tab) => setActiveTab(tab as Tab),
  'pin-reg'
);
```

- [ ] **Step 6: Add/fix useRegisterSubmitAction**

```typescript
useRegisterSubmitAction('pin-reg', {
  description: 'Submit the PIN registration application',
  guard: () => {
    if (activeTab !== 'send') return 'Switch to the Send tab first';
    if (!consentChecked) return 'Consent checkbox must be checked first';
    if (directors.length === 0) return 'At least one director must be added';
    return null;
  },
  onSubmit: () => { /* navigate to success */ },
  successMessage: 'PIN registration application submitted successfully.',
  category: 'pin-reg',
});
```

- [ ] **Step 7: Fix voice-config.ts service IDs**

In `server/voice-config.ts`, fix `coreIds` to use actual service IDs from `src/data/services.ts`. Replace `'company-registration'` → `'register-company'`, `'work-permit'` → `'request-work-permits'`.

- [ ] **Step 8: Verify the build**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 9: Commit the golden reference**

```bash
git add src/components/PinRegistrationApplication.tsx server/voice-config.ts
git commit -m "feat: create golden reference for form integration"
```

### Task 3: Extract golden reference files for the action repo

**Files:**
- Create: `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/before.tsx`
- Create: `/Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/after.tsx`

- [ ] **Step 1: Copy the main branch version (before)**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya
git show main:src/components/PinRegistrationApplication.tsx > /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/before.tsx
```

- [ ] **Step 2: Copy the corrected version (after)**

```bash
git show golden-reference:src/components/PinRegistrationApplication.tsx > /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/after.tsx
```

- [ ] **Step 3: Verify the diff is clean**

```bash
diff /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/before.tsx /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/after.tsx | head -100
```

The diff should show ONLY: new import, useProgressiveFields call, useRegisterUIAction calls, useRegisterTabSwitchAction, useRegisterSubmitAction. No changes to existing JSX, state, or logic.

---

## Chunk 2: Voice Agent Action Repository

Create the `unctad-ai/voice-agent-action` repo with templates, scripts, and golden reference.

**Working directory:** Starts in any directory. Task 4 creates and clones the repo. All subsequent tasks in this chunk work inside the cloned `voice-agent-action` directory.

### Task 4: Create the action repository

**Files:**
- Create: `action.yml`
- Create: `README.md`

- [ ] **Step 1: Create the repo on GitHub**

```bash
gh repo create unctad-ai/voice-agent-action --private --clone
cd voice-agent-action
```

- [ ] **Step 2: Create action.yml (composite action)**

```yaml
name: 'Voice Agent Sync'
description: 'Rebuild voice-agent branch from Figma Make main branch with voice agent integration'
inputs:
  claude_code_oauth_token:
    description: 'Claude Code OAuth token for subscription-based usage'
    required: true
  voice_agent_branch:
    description: 'Target branch name'
    required: false
    default: 'voice-agent'

runs:
  using: 'composite'
  steps:
    - name: Read config
      id: config
      shell: bash
      run: |
        if [ ! -f .voice-agent.yml ]; then
          echo "::error::Missing .voice-agent.yml in repository root"
          exit 1
        fi
        # Parse YAML config (requires yq)
        echo "copilot_name=$(yq '.copilot_name' .voice-agent.yml)" >> $GITHUB_OUTPUT
        echo "copilot_color=$(yq '.copilot_color' .voice-agent.yml)" >> $GITHUB_OUTPUT
        echo "domain=$(yq '.domain' .voice-agent.yml)" >> $GITHUB_OUTPUT
        echo "description=$(yq '.description' .voice-agent.yml)" >> $GITHUB_OUTPUT
        echo "voice_agent_version=$(yq '.voice_agent_version // "latest"' .voice-agent.yml)" >> $GITHUB_OUTPUT
        echo "auto_merge=$(yq '.auto_merge_incremental // "true"' .voice-agent.yml)" >> $GITHUB_OUTPUT

    - name: Detect mode (initial vs incremental)
      id: mode
      shell: bash
      run: |
        if git rev-parse --verify origin/${{ inputs.voice_agent_branch }} &>/dev/null; then
          echo "mode=incremental" >> $GITHUB_OUTPUT
        else
          echo "mode=initial" >> $GITHUB_OUTPUT
        fi

    - name: Backup existing voice-agent branch
      if: steps.mode.outputs.mode == 'incremental'
      shell: bash
      run: |
        TIMESTAMP=$(date +%Y%m%d-%H%M%S)
        git tag "voice-agent-backup-${TIMESTAMP}" "origin/${{ inputs.voice_agent_branch }}"
        git push origin "voice-agent-backup-${TIMESTAMP}"

    - name: Preserve manual additions
      if: steps.mode.outputs.mode == 'incremental'
      id: preserve
      shell: bash
      run: ${{ github.action_path }}/scripts/preserve-manual.sh ${{ inputs.voice_agent_branch }}

    - name: Scaffold from templates
      shell: bash
      run: ${{ github.action_path }}/scripts/scaffold.sh
      env:
        COPILOT_NAME: ${{ steps.config.outputs.copilot_name }}
        VOICE_AGENT_VERSION: ${{ steps.config.outputs.voice_agent_version }}

    - name: Content hash check (skip Claude Code if unchanged)
      id: content_hash
      shell: bash
      run: |
        # Hash the files Claude Code would read — if unchanged, skip the expensive step
        CLAUDE_INPUTS="src/data/services.ts src/App.tsx"
        CLAUDE_INPUTS="$CLAUDE_INPUTS $(find src/components -name '*Application*' -o -name '*Form*' 2>/dev/null || true)"
        HASH=$(cat $CLAUDE_INPUTS 2>/dev/null | sha256sum | cut -d' ' -f1)
        OLD_HASH=$(cat .voice-agent/content-hash 2>/dev/null || echo "none")
        mkdir -p .voice-agent
        echo "$HASH" > .voice-agent/content-hash
        if [[ "$HASH" == "$OLD_HASH" && "${{ steps.mode.outputs.mode }}" == "incremental" ]]; then
          echo "skip=true" >> "$GITHUB_OUTPUT"
          echo "Content unchanged — skipping Claude Code"
        else
          echo "skip=false" >> "$GITHUB_OUTPUT"
        fi

    - name: Claude Code integration
      if: steps.content_hash.outputs.skip != 'true'
      uses: anthropics/claude-code-action@v1
      with:
        claude_code_oauth_token: ${{ inputs.claude_code_oauth_token }}
        prompt: |
          Read the prompt file at ${{ github.action_path }}/prompts/initial-integration.md.
          Follow its instructions exactly.
          The project config is:
          - Copilot name: ${{ steps.config.outputs.copilot_name }}
          - Copilot color: ${{ steps.config.outputs.copilot_color }}
          - Domain: ${{ steps.config.outputs.domain }}
          - Description: ${{ steps.config.outputs.description }}

    - name: Restore preserved files
      if: steps.mode.outputs.mode == 'incremental'
      shell: bash
      run: |
        if [ -d /tmp/voice-agent-preserved ]; then
          cp -r /tmp/voice-agent-preserved/. .
        fi

    - name: Verify build
      shell: bash
      run: ${{ github.action_path }}/scripts/verify.sh

    - name: Update voice-agent branch
      id: push
      shell: bash
      run: |
        git checkout -B ${{ inputs.voice_agent_branch }}
        git add -A

        # Compare tree hash to skip no-op pushes (e.g. cosmetic-only changes on main)
        NEW_TREE=$(git write-tree)
        OLD_TREE=$(git rev-parse "origin/${{ inputs.voice_agent_branch }}^{tree}" 2>/dev/null || echo "none")
        if [[ "$NEW_TREE" == "$OLD_TREE" ]]; then
          echo "Tree unchanged — skipping push (no voice overlay changes)"
          echo "skipped=true" >> "$GITHUB_OUTPUT"
          exit 0
        fi

        git commit -m "chore: rebuild voice-agent from main $(git rev-parse --short main)"
        git push --force origin ${{ inputs.voice_agent_branch }}
        echo "skipped=false" >> "$GITHUB_OUTPUT"

    - name: Create PR (initial) or auto-push (incremental)
      if: steps.push.outputs.skipped != 'true'
      shell: bash
      run: |
        MODE="${{ steps.mode.outputs.mode }}"
        AUTO_MERGE="${{ steps.config.outputs.auto_merge }}"
        if [[ "$MODE" == "initial" ]] || [[ "$AUTO_MERGE" != "true" ]]; then
          gh pr create \
            --base "${{ inputs.voice_agent_branch }}" \
            --head "main" \
            --title "Voice Agent Integration" \
            --body "Auto-generated voice agent integration. Please review form field registrations carefully." \
            || echo "PR already exists"
        fi
```

- [ ] **Step 3: Commit**

```bash
git add action.yml
git commit -m "feat: add composite action definition"
```

### Task 5: Create templates

**Files:**
- Create: `templates/server/Dockerfile`
- Create: `templates/server/index.ts.tmpl`
- Create: `templates/server/package.json.tmpl`
- Create: `templates/Dockerfile.frontend`
- Create: `templates/docker-compose.yml.tmpl`
- Create: `templates/nginx.conf`
- Create: `templates/.dockerignore`

- [ ] **Step 1: Create server Dockerfile**

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
EXPOSE 3001
CMD ["npx", "tsx", "index.ts"]
```

- [ ] **Step 2: Create server index.ts template**

```typescript
import express from 'express';
import cors from 'cors';
import { createVoiceRoutes } from '@unctad-ai/voice-agent-server';
import { siteConfig } from './voice-config.js';

const app = express();
const port = parseInt(process.env.PORT || '3001');

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

const voice = createVoiceRoutes({
  config: siteConfig,
  groqApiKey: process.env.GROQ_API_KEY!,
  kyutaiSttUrl: process.env.KYUTAI_STT_URL,
  qwen3TtsUrl: process.env.QWEN3_TTS_URL,
  pocketTtsUrl: process.env.POCKET_TTS_URL,
});

app.post('/api/chat', voice.chat);
app.use('/api/stt', voice.stt);
app.use('/api/tts', voice.tts);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(port, () => console.log(`Server running on port ${port}`));
```

- [ ] **Step 3: Create server package.json template**

Use `__VOICE_AGENT_VERSION__` placeholder replaced by scaffold.sh:

```json
{
  "name": "voice-agent-server",
  "private": true,
  "type": "module",
  "dependencies": {
    "@unctad-ai/voice-agent-core": "__VOICE_AGENT_VERSION__",
    "@unctad-ai/voice-agent-server": "__VOICE_AGENT_VERSION__",
    "@ai-sdk/groq": "^3.0.0",
    "ai": "^6.0.0",
    "cors": "^2.8.6",
    "dotenv": "^17.0.0",
    "express": "^5.2.0",
    "groq-sdk": "^0.37.0",
    "multer": "^2.0.0",
    "zod": "^3.25.0"
  }
}
```

- [ ] **Step 4: Create Dockerfile.frontend**

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
ARG VITE_BACKEND_URL
ARG VITE_API_KEY
ARG VITE_COPILOT_NAME
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_API_KEY=${VITE_API_KEY}
ENV VITE_COPILOT_NAME=${VITE_COPILOT_NAME}
RUN npx vite build
FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 5: Create docker-compose.yml template**

```yaml
services:
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
      args:
        - VITE_BACKEND_URL=
        - VITE_API_KEY=${CLIENT_API_KEY:-}
        - VITE_COPILOT_NAME=${COPILOT_NAME:-__COPILOT_NAME__}
    expose:
      - "80"
    depends_on:
      - backend
  backend:
    build:
      context: .
      dockerfile: server/Dockerfile
    expose:
      - "3001"
    environment:
      - PORT=3001
      - CORS_ORIGIN=${CORS_ORIGIN:-*}
      - GROQ_API_KEY=${GROQ_API_KEY:-}
      - CLIENT_API_KEY=${CLIENT_API_KEY:-}
      - QWEN3_TTS_URL=${QWEN3_TTS_URL:-}
      - KYUTAI_STT_URL=${KYUTAI_STT_URL:-}
      - POCKET_TTS_URL=${POCKET_TTS_URL:-}
    volumes:
      - persona-data:/app/data/persona

volumes:
  persona-data:
```

> **Note:** The `persona-data` volume persists agent persona config (avatar, name, voice selection) across redeployments. Without it, persona settings are lost on every Coolify redeploy.

- [ ] **Step 6: Create nginx.conf**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_cache off;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 7: Create .dockerignore**

```
node_modules
server/node_modules
.env
server/.env
build
dist
.git
```

- [ ] **Step 8: Commit all templates**

```bash
git add templates/
git commit -m "feat: add deployment templates"
```

### Task 6: Create scaffold script

**Files:**
- Create: `scripts/scaffold.sh`

- [ ] **Step 1: Write scaffold.sh**

This script copies templates into the project, adds voice-agent packages to package.json, and patches vite.config.ts. All operations are idempotent.

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION_ROOT="$(dirname "$SCRIPT_DIR")"
TEMPLATES="$ACTION_ROOT/templates"

VERSION="${VOICE_AGENT_VERSION:-latest}"
if [[ "$VERSION" == "latest" ]]; then
  VERSION="*"
fi

echo "=== Scaffold: copying templates ==="

# Server directory
mkdir -p server
cp "$TEMPLATES/server/Dockerfile" server/Dockerfile
cp "$TEMPLATES/server/index.ts.tmpl" server/index.ts
sed -i "s|__VOICE_AGENT_VERSION__|${VERSION}|g" server/index.ts 2>/dev/null || true

# Server package.json with version substitution
sed "s|__VOICE_AGENT_VERSION__|${VERSION}|g" "$TEMPLATES/server/package.json.tmpl" > server/package.json

# Docker / deploy files
cp "$TEMPLATES/Dockerfile.frontend" Dockerfile.frontend
cp "$TEMPLATES/docker-compose.yml.tmpl" docker-compose.yml
cp "$TEMPLATES/nginx.conf" nginx.conf
cp "$TEMPLATES/.dockerignore" .dockerignore

# Substitute copilot name in docker-compose
COPILOT="${COPILOT_NAME:-Assistant}"
sed -i "s|__COPILOT_NAME__|${COPILOT}|g" docker-compose.yml

echo "=== Scaffold: adding voice-agent packages to package.json ==="

# Add voice-agent packages to frontend package.json if not present
for pkg in "@unctad-ai/voice-agent-core" "@unctad-ai/voice-agent-ui" "@unctad-ai/voice-agent-registries" "@ai-sdk/react"; do
  if ! grep -q "\"$pkg\"" package.json; then
    # Use node to add to dependencies (jq alternative)
    node -e "
      const pkg = JSON.parse(require('fs').readFileSync('package.json','utf8'));
      pkg.dependencies = pkg.dependencies || {};
      pkg.dependencies['$pkg'] = '${VERSION}';
      require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo "  Added $pkg"
  else
    echo "  $pkg already present"
  fi
done

echo "=== Scaffold: patching vite.config.ts ==="

# Add build.outDir: 'build' if not present
if ! grep -q "outDir.*['\"]build['\"]" vite.config.ts 2>/dev/null; then
  # Use node for reliable AST-level patching
  node -e "
    let config = require('fs').readFileSync('vite.config.ts', 'utf8');
    if (!config.includes('outDir')) {
      config = config.replace(
        /export default defineConfig\(\{/,
        'export default defineConfig({\n  build: { outDir: \"build\" },'
      );
      require('fs').writeFileSync('vite.config.ts', config);
      console.log('  Added build.outDir: build');
    }
  "
else
  echo "  outDir already set"
fi

# Add ten-vad-glue alias if not present
if ! grep -q "ten-vad-glue" vite.config.ts 2>/dev/null; then
  node -e "
    let config = require('fs').readFileSync('vite.config.ts', 'utf8');
    if (config.includes('alias')) {
      // Add to existing alias object
      config = config.replace(
        /alias:\s*\{/,
        'alias: {\n      \"ten-vad-glue\": \"./node_modules/@gooney-001/ten-vad-lib/ten_vad.js\",'
      );
    } else {
      // Add resolve.alias section
      config = config.replace(
        /export default defineConfig\(\{/,
        'export default defineConfig({\n  resolve: { alias: { \"ten-vad-glue\": \"./node_modules/@gooney-001/ten-vad-lib/ten_vad.js\" } },'
      );
    }
    require('fs').writeFileSync('vite.config.ts', config);
    console.log('  Added ten-vad-glue alias');
  "
else
  echo "  ten-vad-glue alias already present"
fi

echo "=== Scaffold complete ==="
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/scaffold.sh
git add scripts/scaffold.sh
git commit -m "feat: add scaffold script"
```

### Task 7: Create verify script

**Files:**
- Create: `scripts/verify.sh`

- [ ] **Step 1: Write verify.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Verify: Docker build ==="

# Build frontend
echo "Building frontend..."
docker build -f Dockerfile.frontend -t voice-agent-frontend-test . 2>&1 | tail -5
echo "  Frontend: OK"

# Build backend
echo "Building backend..."
docker build -f server/Dockerfile -t voice-agent-backend-test server/ 2>&1 | tail -5
echo "  Backend: OK"

# Run tests if they exist
if grep -q '"test"' package.json 2>/dev/null; then
  echo "=== Verify: Running tests ==="
  npm test || { echo "Tests failed"; exit 1; }
fi

echo "=== Verify: All checks passed ==="
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/verify.sh
git add scripts/verify.sh
git commit -m "feat: add verify script"
```

### Task 8: Create preserve-manual script

**Files:**
- Create: `scripts/preserve-manual.sh`

- [ ] **Step 1: Write preserve-manual.sh**

This script saves files from the old voice-agent branch that are manual additions (not auto-generated, not on main).

```bash
#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-voice-agent}"
PRESERVE_DIR="/tmp/voice-agent-preserved"
rm -rf "$PRESERVE_DIR"
mkdir -p "$PRESERVE_DIR"

# Auto-generated files (will be regenerated — don't preserve)
AUTO_GENERATED=(
  "src/voice-config.ts"
  "server/voice-config.ts"
  "server/index.ts"
  "server/package.json"
  "server/Dockerfile"
  "Dockerfile.frontend"
  "docker-compose.yml"
  "nginx.conf"
  ".dockerignore"
  ".voice-agent/manifest.yml"
)

# Modified files (will be re-patched — don't preserve)
MODIFIED=(
  "src/App.tsx"
  "package.json"
  "vite.config.ts"
)

echo "=== Preserving manual additions from $BRANCH ==="

# Get list of files on voice-agent that don't exist on main
VOICE_FILES=$(git ls-tree -r --name-only "origin/$BRANCH" 2>/dev/null || true)
MAIN_FILES=$(git ls-tree -r --name-only "origin/main" 2>/dev/null || git ls-tree -r --name-only main)

for file in $VOICE_FILES; do
  # Skip if file exists on main
  if echo "$MAIN_FILES" | grep -qx "$file"; then
    continue
  fi

  # Skip auto-generated files
  SKIP=false
  for auto in "${AUTO_GENERATED[@]}"; do
    if [[ "$file" == "$auto" ]]; then SKIP=true; break; fi
  done
  if $SKIP; then continue; fi

  # Skip modified files
  for mod in "${MODIFIED[@]}"; do
    if [[ "$file" == "$mod" ]]; then SKIP=true; break; fi
  done
  if $SKIP; then continue; fi

  # Preserve this file
  mkdir -p "$PRESERVE_DIR/$(dirname "$file")"
  git show "origin/$BRANCH:$file" > "$PRESERVE_DIR/$file"
  echo "  Preserved: $file"
done

# Also preserve form component modifications (Tier 2)
# These are files that exist on BOTH main and voice-agent, but voice-agent has hook additions
MANIFEST_FILE=$(git show "origin/$BRANCH:.voice-agent/manifest.yml" 2>/dev/null || true)
if [[ -n "$MANIFEST_FILE" ]]; then
  # Read tier2 files from manifest
  TIER2_FILES=$(echo "$MANIFEST_FILE" | grep "^  - " | sed 's/^  - //' || true)
  for file in $TIER2_FILES; do
    # Check if main changed this file since last run
    MAIN_HASH=$(git rev-parse "main:$file" 2>/dev/null || echo "none")
    STORED_HASH=$(echo "$MANIFEST_FILE" | grep -A1 "$file" | grep "main_hash:" | awk '{print $2}' || echo "")

    if [[ "$MAIN_HASH" == "$STORED_HASH" ]]; then
      # Main hasn't changed — preserve the integrated version
      mkdir -p "$PRESERVE_DIR/$(dirname "$file")"
      git show "origin/$BRANCH:$file" > "$PRESERVE_DIR/$file"
      echo "  Preserved (Tier 2): $file"
    else
      echo "  CHANGED on main (needs re-integration): $file"
    fi
  done
fi

echo "=== Preservation complete ==="
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/preserve-manual.sh
git add scripts/preserve-manual.sh
git commit -m "feat: add manual preservation script"
```

### Task 9: Create detect-changes script

**Files:**
- Create: `scripts/detect-changes.sh`

- [ ] **Step 1: Write detect-changes.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Classify what changed on main to determine if Claude Code is needed
# Output: space-separated list of change types

CHANGES=""

# Get changed files between previous and current main
CHANGED_FILES=$(git diff --name-only HEAD~1..HEAD 2>/dev/null || git ls-files)

for file in $CHANGED_FILES; do
  case "$file" in
    src/data/services*|src/data/serviceCategories*)
      CHANGES="$CHANGES services"
      ;;
    src/App.tsx|src/routes*)
      CHANGES="$CHANGES navigation"
      ;;
    src/components/*Application*|src/components/*Form*)
      CHANGES="$CHANGES forms"
      ;;
    src/components/*|src/pages/*)
      CHANGES="$CHANGES components"
      ;;
    *.css|*.scss|*.png|*.jpg|*.svg|src/assets/*)
      CHANGES="$CHANGES cosmetic"
      ;;
    *)
      CHANGES="$CHANGES other"
      ;;
  esac
done

# Deduplicate
CHANGES=$(echo "$CHANGES" | tr ' ' '\n' | sort -u | tr '\n' ' ')

if [[ -z "$CHANGES" || "$CHANGES" =~ ^[[:space:]]*cosmetic[[:space:]]*$ ]]; then
  echo "cosmetic-only"
else
  echo "$CHANGES"
fi
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/detect-changes.sh
git add scripts/detect-changes.sh
git commit -m "feat: add change detection script"
```

---

## Chunk 3: Claude Code Prompts

Write the prompts that drive Claude Code's intelligent integration work.

**Working directory:** Inside the `voice-agent-action` repo (cloned in Chunk 2). Task 12 temporarily switches to the Bhutan repo for validation.

### Task 10: Write initial integration prompt

**Files:**
- Create: `prompts/initial-integration.md`
- Copy: `golden-reference/before.tsx` (from Task 3)
- Copy: `golden-reference/after.tsx` (from Task 3)

- [ ] **Step 1: Copy golden reference files into the action repo**

```bash
cp /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/before.tsx golden-reference/before.tsx
cp /Users/moulaymehdi/PROJECTS/figma/voice-agent-kit/docs/superpowers/specs/golden-reference/after.tsx golden-reference/after.tsx
git add golden-reference/
git commit -m "feat: add golden reference before/after example"
```

- [ ] **Step 2: Write the initial integration prompt**

Create `prompts/initial-integration.md` with these sections:

1. **Role**: "You are integrating voice agent support into a Figma Make-generated React project."

2. **What to do** (in order):
   - Wrap App.tsx: find the Router component, wrap its children with `<VoiceAgentProvider config={siteConfig}>` and add `<GlassCopilotPanel />`. Import from `@unctad-ai/voice-agent-core` and `@unctad-ai/voice-agent-ui`.
   - Generate `src/voice-config.ts`: read `src/data/services.ts` to extract services, read `App.tsx` to extract routes, read `.voice-agent.yml` for copilot config. Exclude routes listed in `exclude_routes`.
   - Generate `server/voice-config.ts`: mirror client config, add `extraServerTools` if domain-specific tools make sense (e.g., `recommendServices`, `compareServices`).
   - Integrate form fields: for each form component (files matching `*Application*.tsx` or `*Form*.tsx` in `src/components/`), add voice agent hooks.

3. **Form integration rules** (reference the golden-reference/before.tsx and golden-reference/after.tsx):
   - Use `useProgressiveFields` exclusively
   - ID convention: `{prefix}.{section}.{field}`
   - Domain-prefixed labels
   - `select` type with options for `<select>` elements
   - Correct input types (`tel`, `email`, `date`)
   - Object state → per-property with `prev =>` setter
   - `visible` from JSX tree walking + `!isProcessing*` guards
   - Skip uncontrolled inputs (no React state)
   - Skip UI state (loading, modal, validation flags)
   - Add `useRegisterUIAction` for button actions with descriptive return strings
   - Add `useRegisterTabSwitchAction` for tab navigation
   - Add `useRegisterSubmitAction` for form submission
   - Skip components > 2000 lines (flag in PR comment instead)

4. **Validation**: after generating, verify every service ID in voice-config exists in services.ts, every route target matches an actual route in App.tsx, every form field ID references a real useState variable.

5. **Output**: list all files created/modified so the action can track them in the manifest.

- [ ] **Step 3: Commit**

```bash
git add prompts/initial-integration.md
git commit -m "feat: add initial integration prompt with golden reference"
```

### Task 11: Write incremental update prompt

**Files:**
- Create: `prompts/incremental-update.md`

- [ ] **Step 1: Write the incremental update prompt**

Create `prompts/incremental-update.md`:

1. **Role**: "The designer updated the React project on main. Analyze changes and update voice agent integration files."

2. **Context provided by action**: the output of `detect-changes.sh` (which categories changed: services, navigation, forms, cosmetic-only).

3. **If services changed**: re-read `src/data/services.ts`, regenerate `src/voice-config.ts` services array and `server/voice-config.ts` services.

4. **If navigation changed**: re-read `App.tsx` routes, update `routeMap` and `getServiceFormRoute` in both voice-config files.

5. **If forms changed**: for each changed form component, re-run form integration using the golden reference pattern. Compare with the preserved version to minimize unnecessary changes.

6. **If cosmetic-only**: do nothing (the action skips Claude Code entirely for cosmetic changes, so this prompt is never called in that case).

7. **Rules**: only modify voice-config files and form components. Never modify the designer's original files except as specified.

- [ ] **Step 2: Commit**

```bash
git add prompts/incremental-update.md
git commit -m "feat: add incremental update prompt"
```

### Task 12: Test the initial prompt against Bhutan

**Files:**
- Read: Bhutan `main` branch components

This is a validation test — run the prompt (manually or via Claude Code) against Bhutan's main branch to verify it produces reasonable output.

- [ ] **Step 1: Simulate integration on Bhutan**

Run Claude Code with the initial-integration prompt against Bhutan's main branch:

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swbhutan
git checkout main
```

Have Claude Code read the golden reference, then:
- Read `src/data/services.ts` → generate voice-config.ts
- Read `App.tsx` → extract routes
- Read form components → generate useProgressiveFields calls
- Compare output to the existing `voice-agent` branch on Swbhutan

- [ ] **Step 2: Document accuracy**

Score the output: field count, IDs, labels, types, visible conditions, UI actions. Target: 90%+ on controlled fields.

- [ ] **Step 3: Iterate on prompt if score < 90%**

Adjust the prompt based on failure patterns. Re-test until 90%+ accuracy.

- [ ] **Step 4: Commit final prompt version**

```bash
git add prompts/
git commit -m "feat: refine prompts based on Bhutan validation"
```

---

## Chunk 4: End-to-End Testing

Test the complete action on a real project before deploying to production repos.

**Working directory:** Creates a test repo at `/Users/moulaymehdi/PROJECTS/figma/voice-agent-test-project`. Most work is via `gh` CLI commands (remote operations).

### Task 13: Create a test repository

**Files:**
- Create: `unctad-ai/voice-agent-test-project` (fork or copy of Kenya main)

- [ ] **Step 1: Create test repo from Kenya main**

```bash
gh repo create unctad-ai/voice-agent-test-project --private
cd /Users/moulaymehdi/PROJECTS/figma
git clone git@github.com:unctad-ai/voice-agent-test-project.git
cd voice-agent-test-project
# Copy Kenya main branch content
git -C /Users/moulaymehdi/PROJECTS/figma/Swkenya archive main | tar -x
git add -A
git commit -m "Initial Figma Make output (copy of Kenya main)"
git push
```

- [ ] **Step 2: Add .voice-agent.yml**

```yaml
copilot_name: "Test Assistant"
copilot_color: "#1B5E20"
domain: "test.singlewindow.dev"
description: "Test project for voice agent automation"
voice_agent_version: "latest"
auto_merge_incremental: false
exclude_routes: ["/2", "/3", "/green", "/red", "/red2", "/home2", "/home3"]
```

- [ ] **Step 3: Add workflow file**

```yaml
# .github/workflows/voice-agent-sync.yml
name: Voice Agent Sync
on:
  push:
    branches: [main]
  workflow_dispatch:
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
      - uses: unctad-ai/voice-agent-action@main
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

- [ ] **Step 4: Commit and push**

```bash
git add .voice-agent.yml .github/
git commit -m "feat: add voice agent automation config"
git push
```

### Task 14: Run the action and validate

- [ ] **Step 1: Add CLAUDE_CODE_OAUTH_TOKEN secret to test repo**

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo unctad-ai/voice-agent-test-project
```

- [ ] **Step 2: Trigger the workflow**

```bash
gh workflow run voice-agent-sync.yml --repo unctad-ai/voice-agent-test-project
```

- [ ] **Step 3: Monitor the run**

```bash
gh run watch --repo unctad-ai/voice-agent-test-project
```

- [ ] **Step 4: Validate the output**

Check the PR created:
```bash
gh pr list --repo unctad-ai/voice-agent-test-project
gh pr view 1 --repo unctad-ai/voice-agent-test-project
```

Verify:
- `voice-agent` branch was created
- PR contains: server/, Docker files, nginx.conf, voice-config.ts, App.tsx modifications, form hooks
- Docker build step passed
- Form components have `useProgressiveFields` calls

- [ ] **Step 5: Fix any issues and re-run**

If the action failed or produced incorrect output, fix the scripts/prompts and re-run.

### Task 15: Test incremental update

- [ ] **Step 1: Simulate a designer push**

Add a new service to `src/data/services.ts` on main:

```bash
cd /Users/moulaymehdi/PROJECTS/figma/voice-agent-test-project
# Add a test service to services.ts
git add src/data/services.ts
git commit -m "Add new service (simulating designer update)"
git push
```

- [ ] **Step 2: Wait for action to run**

```bash
gh run watch --repo unctad-ai/voice-agent-test-project
```

- [ ] **Step 3: Verify incremental update**

Check that:
- `voice-agent` branch was rebuilt from new main
- voice-config.ts includes the new service
- Form components were preserved (not regenerated)
- PR was created (since `auto_merge_incremental: false`)

---

## Chunk 5: Migration of Existing Projects

Deploy the action to Kenya, Bhutan, South Africa, and Lesotho.

**Working directories:** Switches between all consuming project repos (paths listed in Prerequisites).

### Task 16: Standardize branch names

> **ALREADY COMPLETE** — All repos have been renamed (`Sw*` convention) and all voice-agent branches are already standardized to `voice-agent`. No action needed.

### Task 17: Add automation config to Kenya

- [ ] **Step 1: Add .voice-agent.yml to main**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swkenya
git checkout main
```

Create `.voice-agent.yml`:
```yaml
copilot_name: "Pesa"
copilot_color: "#DB2129"
domain: "kenya.singlewindow.dev"
description: "Kenya Trade Single Window — business registration, permits, and investment services"
voice_agent_version: "^1.0.0"
auto_merge_incremental: true
exclude_routes: ["/2", "/3", "/green", "/red", "/red2", "/home2", "/home3", "/design-system"]
```

- [ ] **Step 2: Add workflow**

Create `.github/workflows/voice-agent-sync.yml` (same as test project but using `@v1`).

- [ ] **Step 3: Commit and push**

```bash
git add .voice-agent.yml .github/
git commit -m "feat: add voice agent automation"
git push origin main
```

### Task 18: Add automation config to Bhutan

- [ ] **Step 1: Add .voice-agent.yml to main**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swbhutan
git checkout main
```

```yaml
copilot_name: "Druk"
copilot_color: "#FF6B00"
domain: "bhutan.singlewindow.dev"
description: "Bhutan ePhyto — phytosanitary certificates, investment, and business registration"
voice_agent_version: "^1.0.0"
auto_merge_incremental: true
exclude_routes: ["/design-system"]
```

- [ ] **Step 2: Add workflow and commit**

Same pattern as Kenya.

### Task 19: Add automation config to South Africa

- [ ] **Step 1: Add .voice-agent.yml to main**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Swsouthafrica
git checkout main
```

```yaml
copilot_name: "Amy"
copilot_color: "#1B4332"
domain: "southafrica.singlewindow.dev"
description: "South Africa License Portal — business licenses, permits, and regulatory compliance"
voice_agent_version: "^1.0.0"
auto_merge_incremental: true
exclude_routes: []
```

- [ ] **Step 2: Add workflow and commit**

Same pattern as Kenya.

### Task 20: Verify all three projects

- [ ] **Step 1: Trigger workflows**

```bash
for repo in Swkenya Swbhutan Swsouthafrica; do
  gh workflow run voice-agent-sync.yml --repo "unctad-ai/$repo" || echo "$repo: workflow not found (may need manual trigger)"
done
```

- [ ] **Step 2: Monitor runs**

```bash
for repo in Swkenya Swbhutan Swsouthafrica; do
  echo "=== $repo ==="
  gh run list --repo "unctad-ai/$repo" --limit 1
done
```

- [ ] **Step 3: Review PRs**

For each project, review the PR created by the action. Check:
- voice-config.ts has correct services and routes
- Form components have correct useProgressiveFields calls
- Docker build passed
- No regressions from existing voice-agent integration

- [ ] **Step 4: Merge PRs after review**

```bash
for repo in Swkenya Swbhutan Swsouthafrica; do
  gh pr merge 1 --repo "unctad-ai/$repo" --squash
done
```

- [ ] **Step 5: Verify Coolify deployments**

```bash
for domain in kenya bhutan southafrica; do
  echo -n "${domain}.singlewindow.dev: "
  curl -so /dev/null -w "%{http_code}" "https://${domain}.singlewindow.dev"
  echo -n " API: "
  curl -so /dev/null -w "%{http_code}" "https://${domain}.singlewindow.dev/api/health"
  echo
done
```

Expected: `200` for all endpoints.
