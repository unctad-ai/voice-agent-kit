# Single Window Deployment Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up Coolify on the singlewindow server, onboard three existing voice agent projects with auto-deploy, and create a `singlewindow-deployments` repo with automation scripts.

**Architecture:** Coolify runs on the singlewindow server (157.180.127.65) managing all voice agent demo projects. Each project is a Docker Compose app (frontend nginx + Express backend) deployed from its GitHub repo's voice-agent branch. Traefik handles routing by subdomain (`<name>.singlewindow.dev`) with auto Let's Encrypt SSL. A central `singlewindow-deployments` repo holds templates, per-project configs, and automation scripts.

**Tech Stack:** Coolify (self-hosted PaaS), Docker Compose, Traefik, Let's Encrypt, Bash scripts, Coolify REST API (`/api/v1`), GitHub webhooks

**Reference:** See `docs/superpowers/specs/2026-03-10-singlewindow-deployment-architecture.md` for the full design spec.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| (singlewindow server) | Install | Coolify instance |
| `singlewindow-deployments/README.md` | Create | Onboarding guide |
| `singlewindow-deployments/templates/docker-compose.yml` | Create | Standard compose template for voice agent projects |
| `singlewindow-deployments/templates/Dockerfile.frontend` | Create | Standardized frontend Dockerfile |
| `singlewindow-deployments/templates/server/Dockerfile` | Create | Standardized backend Dockerfile |
| `singlewindow-deployments/templates/nginx.conf` | Create | Standardized nginx config for frontend |
| `singlewindow-deployments/templates/.env.example` | Create | Documented env var template |
| `singlewindow-deployments/projects/kenya.yml` | Create | Kenya project config |
| `singlewindow-deployments/projects/bhutan.yml` | Create | Bhutan project config |
| `singlewindow-deployments/projects/licenses.yml` | Create | Licenses project config |
| `singlewindow-deployments/scripts/onboard-project.sh` | Create | Add new project to Coolify via API |
| `singlewindow-deployments/scripts/update-all.sh` | Create | Bump voice-agent-kit in all project repos |
| `singlewindow-deployments/scripts/backup-coolify.sh` | Create | Export Coolify config to repo |

---

## Chunk 1: Install Coolify on Single Window Server

### Task 1: Install Coolify

**Files:** None (remote server operations)

- [ ] **Step 1: Verify DNS has propagated**

Run:
```bash
dig +short singlewindow.dev A
```

Expected: `157.180.127.65`. If not, wait for DNS propagation before continuing.

- [ ] **Step 2: SSH into singlewindow and run the Coolify installer**

Run:
```bash
ssh singlewindow "curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash"
```

This installs Docker (already present), Coolify containers, and Traefik. The script is idempotent — safe to re-run.

Expected: Script completes with a message showing the dashboard URL at `http://157.180.127.65:8000`.

- [ ] **Step 3: Verify Coolify is running**

Run:
```bash
ssh singlewindow "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'coolify|traefik'"
```

Expected: Coolify and Traefik containers are running. Traefik should be bound to ports 80 and 443.

- [ ] **Step 4: Verify the Kenya agent containers survived the install**

Run:
```bash
ssh singlewindow "docker ps --format '{{.Names}}' | grep kenya"
```

Expected: `kenya-agent-frontend-1`, `kenya-agent-backend-1`, `kenya-agent-pocket-tts-1` still running.

If they were stopped, restart them:
```bash
ssh singlewindow "cd /path/to/kenya-compose && docker compose up -d"
```

---

### Task 2: Configure Coolify Dashboard

- [ ] **Step 1: Open Coolify dashboard and create admin account**

Open `http://157.180.127.65:8000` in a browser. Register the admin account on the first-visit registration page. Save credentials securely.

- [ ] **Step 2: Set the Coolify instance domain**

In Coolify UI: Settings → General → Instance's Domain → set to `https://coolify.singlewindow.dev`

This configures Traefik to route `coolify.singlewindow.dev` to the dashboard with auto SSL.

- [ ] **Step 3: Verify HTTPS works for dashboard**

Open `https://coolify.singlewindow.dev` in a browser. It should load the Coolify dashboard with a valid SSL certificate.

If SSL fails, DNS may not have propagated yet. Check:
```bash
dig +short coolify.singlewindow.dev A
```

- [ ] **Step 4: Generate an API token**

In Coolify UI: Settings → Keys & Tokens → API Tokens → Create new token with `read`, `write`, `deploy` abilities.

Save the token — it will be used in automation scripts. Store it in a secure location (not in the repo).

- [ ] **Step 5: Connect GitHub**

In Coolify UI: Sources → Add → GitHub App.

Follow the OAuth flow to install the Coolify GitHub App on the `celiaaivalioti` GitHub organization/account with access to:
- `Kenyaservices`
- `Bhutanephyto`
- `Licenseportaldemo`
- (and any future repos)

Note the GitHub App ID — it's needed for API calls when creating applications.

- [ ] **Step 6: Verify API access**

Run:
```bash
curl -s -H "Authorization: Bearer <API_TOKEN>" https://coolify.singlewindow.dev/api/v1/projects | jq .
```

Expected: JSON response (empty array or default project list). HTTP 200.

---

## Chunk 2: Create singlewindow-deployments Repo

### Task 3: Initialize the repo

- [ ] **Step 1: Create the repo on GitHub**

Run:
```bash
gh repo create celiaaivalioti/singlewindow-deployments --private --description "Coolify deployment configs for voice agent demo projects" --clone
```

- [ ] **Step 2: Create the directory structure**

Run:
```bash
cd singlewindow-deployments
mkdir -p coolify scripts templates/server projects
```

---

### Task 4: Create templates

These templates are extracted from the existing projects (Kenya, Bhutan, Licenses are nearly identical).

- [ ] **Step 1: Create the frontend Dockerfile template**

Create `templates/Dockerfile.frontend`:

```dockerfile
# Stage 1: Build
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 2: Create the nginx.conf template**

Create `templates/nginx.conf`:

```nginx
server {
    listen 3000;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://backend:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support for streaming chat responses
        proxy_set_header Connection '';
        proxy_cache off;
        proxy_buffering off;
        chunked_transfer_encoding on;
        proxy_read_timeout 300s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Create the backend Dockerfile template**

Create `templates/server/Dockerfile`:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY server/package*.json ./server/
COPY package*.json ./
RUN cd server && npm ci
COPY server/ ./server/
COPY src/data/ ./src/data/ 2>/dev/null || true
COPY src/utils/ ./src/utils/ 2>/dev/null || true
WORKDIR /app/server
EXPOSE 3001
CMD ["npx", "tsx", "index.ts"]
```

- [ ] **Step 4: Create the docker-compose template**

Create `templates/docker-compose.yml`:

```yaml
# Voice Agent Project - Docker Compose Template
# Copy to your project root and update SERVICE_NAME and DOMAIN
services:
  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    restart: unless-stopped
    depends_on:
      - backend
    expose:
      - "3000"

  backend:
    build:
      context: .
      dockerfile: server/Dockerfile
    restart: unless-stopped
    env_file:
      - server/.env
    expose:
      - "3001"
    environment:
      - CORS_ORIGIN=https://${DOMAIN}
    volumes:
      - persona-data:/app/data/persona

volumes:
  persona-data:
```

> **Note:** The `persona-data` volume persists agent persona config (avatar, name, voice selection) across redeployments. Without it, persona settings would be lost on every Coolify redeploy.

- [ ] **Step 5: Create the .env.example**

Create `templates/.env.example`:

```bash
# === Shared (same across all projects) ===
GROQ_API_KEY=            # LLM provider API key
KYUTAI_STT_URL=          # Full URL to Kyutai STT server
QWEN3_TTS_URL=           # Full URL to Qwen3 TTS server
POCKET_TTS_URL=          # Full URL to Pocket TTS fallback

# === Per-project (unique per deployment) ===
CLIENT_API_KEY=          # API key for frontend-backend auth
CORS_ORIGIN=             # https://<project>.singlewindow.dev
```

- [ ] **Step 6: Commit templates**

```bash
git add templates/
git commit -m "chore: add project templates (Dockerfiles, compose, nginx, env)"
```

---

### Task 5: Create per-project config files

- [ ] **Step 1: Create Kenya config**

Create `projects/kenya.yml`:

```yaml
name: kenya
repo: celiaaivalioti/Kenyaservices
branch: voice-agent-refactor
domain: kenya.singlewindow.dev
copilot_name: Pesa
description: Kenya eCitizen services voice assistant
```

- [ ] **Step 2: Create Bhutan config**

Create `projects/bhutan.yml`:

```yaml
name: bhutan
repo: celiaaivalioti/Bhutanephyto
branch: feat/multi-voice-support
domain: bhutan.singlewindow.dev
copilot_name: ePhyto
description: Bhutan ePhyto certificate voice assistant
```

- [ ] **Step 3: Create Licenses config**

Create `projects/licenses.yml`:

```yaml
name: licenses
repo: celiaaivalioti/Licenseportaldemo
branch: voice-agent
domain: licenses.singlewindow.dev
copilot_name: License Portal
description: License portal demo voice assistant
```

- [ ] **Step 4: Commit project configs**

```bash
git add projects/
git commit -m "chore: add project configs for Kenya, Bhutan, Licenses"
```

---

## Chunk 3: Automation Scripts

### Task 6: Create the onboard-project script

This script reads a project YAML and creates the application in Coolify via API.

- [ ] **Step 1: Create the onboard script**

Create `scripts/onboard-project.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/onboard-project.sh projects/<name>.yml
# Requires: COOLIFY_TOKEN and COOLIFY_URL env vars (or .env file)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Load env
if [[ -f "$REPO_ROOT/.env" ]]; then
  source "$REPO_ROOT/.env"
fi

COOLIFY_URL="${COOLIFY_URL:-https://coolify.singlewindow.dev}"
COOLIFY_TOKEN="${COOLIFY_TOKEN:?Set COOLIFY_TOKEN env var or add to .env}"
GITHUB_APP_UUID="${GITHUB_APP_UUID:?Set GITHUB_APP_UUID env var or add to .env}"
SERVER_UUID="${SERVER_UUID:?Set SERVER_UUID env var or add to .env}"

PROJECT_FILE="${1:?Usage: $0 projects/<name>.yml}"

if [[ ! -f "$PROJECT_FILE" ]]; then
  echo "Error: $PROJECT_FILE not found"
  exit 1
fi

# Parse YAML (simple key: value parsing, no nested structures)
parse_yaml() {
  grep "^$1:" "$PROJECT_FILE" | sed "s/^$1: *//"
}

NAME=$(parse_yaml name)
REPO=$(parse_yaml repo)
BRANCH=$(parse_yaml branch)
DOMAIN=$(parse_yaml domain)
DESCRIPTION=$(parse_yaml description)

echo "Onboarding: $NAME"
echo "  Repo:   $REPO ($BRANCH)"
echo "  Domain: $DOMAIN"
echo ""

# Step 1: Create project
echo "Creating project..."
PROJECT_RESPONSE=$(curl -sf \
  -X POST "$COOLIFY_URL/api/v1/projects" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$NAME\", \"description\": \"$DESCRIPTION\"}")

PROJECT_UUID=$(echo "$PROJECT_RESPONSE" | jq -r '.uuid')
echo "  Project UUID: $PROJECT_UUID"

# Step 2: Create application (Docker Compose from GitHub)
echo "Creating application..."
APP_RESPONSE=$(curl -sf \
  -X POST "$COOLIFY_URL/api/v1/applications/private-github-app" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"project_uuid\": \"$PROJECT_UUID\",
    \"server_uuid\": \"$SERVER_UUID\",
    \"github_app_uuid\": \"$GITHUB_APP_UUID\",
    \"git_repository\": \"$REPO\",
    \"git_branch\": \"$BRANCH\",
    \"build_pack\": \"dockercompose\",
    \"docker_compose_location\": \"/docker-compose.yml\",
    \"instant_deploy\": false,
    \"name\": \"$NAME\"
  }")

APP_UUID=$(echo "$APP_RESPONSE" | jq -r '.uuid')
echo "  App UUID: $APP_UUID"

# Step 3: Set domain
echo "Setting domain to $DOMAIN..."
curl -sf \
  -X PATCH "$COOLIFY_URL/api/v1/applications/$APP_UUID" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"domains\": [\"https://$DOMAIN\"]}" > /dev/null

# Step 4: Set shared environment variables
echo "Setting shared env vars..."
SHARED_ENVS=$(cat "$REPO_ROOT/.env.shared" 2>/dev/null || echo "")
if [[ -n "$SHARED_ENVS" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    curl -sf \
      -X POST "$COOLIFY_URL/api/v1/applications/$APP_UUID/envs" \
      -H "Authorization: Bearer $COOLIFY_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\": \"$key\", \"value\": \"$value\", \"is_build_time\": false}" > /dev/null
  done <<< "$SHARED_ENVS"
fi

# Step 5: Set per-project env vars
echo "Setting per-project env vars..."
curl -sf \
  -X POST "$COOLIFY_URL/api/v1/applications/$APP_UUID/envs" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"key\": \"CORS_ORIGIN\", \"value\": \"https://$DOMAIN\", \"is_build_time\": false}" > /dev/null

echo ""
echo "Done! Deploy from Coolify UI or run:"
echo "  curl -X POST $COOLIFY_URL/api/v1/applications/$APP_UUID/start \\"
echo "    -H 'Authorization: Bearer $COOLIFY_TOKEN'"
echo ""
echo "App UUID: $APP_UUID"
```

- [ ] **Step 2: Make it executable and commit**

```bash
chmod +x scripts/onboard-project.sh
git add scripts/onboard-project.sh
git commit -m "feat: add onboard-project script (Coolify API)"
```

---

### Task 7: Create the update-all script

- [ ] **Step 1: Create the update script**

Create `scripts/update-all.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/update-all.sh [version]
# Updates @unctad-ai/voice-agent-* packages in all project repos.
# If no version specified, uses @latest.

VERSION="${1:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECTS_DIR="$REPO_ROOT/projects"

echo "Updating voice-agent packages to: $VERSION"
echo ""

for config in "$PROJECTS_DIR"/*.yml; do
  NAME=$(grep "^name:" "$config" | sed "s/^name: *//")
  REPO=$(grep "^repo:" "$config" | sed "s/^repo: *//")
  BRANCH=$(grep "^branch:" "$config" | sed "s/^branch: *//")

  echo "=== $NAME ($REPO@$BRANCH) ==="

  TMPDIR=$(mktemp -d)
  git clone --depth 1 --branch "$BRANCH" "git@github.com:$REPO.git" "$TMPDIR" 2>/dev/null

  cd "$TMPDIR"

  # Update frontend packages
  npm install \
    "@unctad-ai/voice-agent-core@$VERSION" \
    "@unctad-ai/voice-agent-registries@$VERSION" \
    "@unctad-ai/voice-agent-ui@$VERSION" 2>/dev/null

  # Check if anything changed
  if git diff --quiet package.json package-lock.json; then
    echo "  Already up to date."
  else
    RESOLVED=$(node -e "console.log(require('./node_modules/@unctad-ai/voice-agent-core/package.json').version)")
    git add package.json package-lock.json
    git commit -m "chore: bump voice-agent packages to v$RESOLVED"
    git push origin "$BRANCH"
    echo "  Updated to v$RESOLVED and pushed."
  fi

  rm -rf "$TMPDIR"
  echo ""
done

echo "All projects updated. Coolify will auto-deploy if webhooks are configured."
```

- [ ] **Step 2: Make it executable and commit**

```bash
chmod +x scripts/update-all.sh
git add scripts/update-all.sh
git commit -m "feat: add update-all script for bulk voice-agent-kit bumps"
```

---

### Task 8: Create the backup script

- [ ] **Step 1: Create the backup script**

Create `scripts/backup-coolify.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/backup-coolify.sh
# Exports Coolify configuration (projects, apps, envs) to coolify/ directory.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

source "$REPO_ROOT/.env" 2>/dev/null || true
COOLIFY_URL="${COOLIFY_URL:-https://coolify.singlewindow.dev}"
COOLIFY_TOKEN="${COOLIFY_TOKEN:?Set COOLIFY_TOKEN}"

BACKUP_DIR="$REPO_ROOT/coolify"
mkdir -p "$BACKUP_DIR"

echo "Backing up Coolify config..."

# Export projects
curl -sf \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/projects" | jq . > "$BACKUP_DIR/projects.json"
echo "  Projects exported."

# Export applications
curl -sf \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/applications" | jq . > "$BACKUP_DIR/applications.json"
echo "  Applications exported."

# Export server info
curl -sf \
  -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "$COOLIFY_URL/api/v1/servers" | jq . > "$BACKUP_DIR/servers.json"
echo "  Servers exported."

echo ""
echo "Backup saved to $BACKUP_DIR/"
echo "Commit with: git add coolify/ && git commit -m 'chore: backup Coolify config'"
```

- [ ] **Step 2: Make it executable and commit**

```bash
chmod +x scripts/backup-coolify.sh
git add scripts/backup-coolify.sh
git commit -m "feat: add backup-coolify script"
```

---

### Task 9: Create README and finalize repo

- [ ] **Step 1: Create README.md**

Create `README.md`:

```markdown
# singlewindow-deployments

Deployment configs and automation for voice agent demo projects on `singlewindow.dev`.

## Architecture

- **Platform:** [Coolify](https://coolify.io) (self-hosted PaaS)
- **Server:** singlewindow (157.180.127.65)
- **Domain:** *.singlewindow.dev (wildcard DNS)
- **SSL:** Auto Let's Encrypt via Traefik
- **Dashboard:** https://coolify.singlewindow.dev

## Projects

| Project | Domain | Repo | Branch |
|---------|--------|------|--------|
| Kenya | kenya.singlewindow.dev | celiaaivalioti/Kenyaservices | voice-agent-refactor |
| Bhutan | bhutan.singlewindow.dev | celiaaivalioti/Bhutanephyto | feat/multi-voice-support |
| Licenses | licenses.singlewindow.dev | celiaaivalioti/Licenseportaldemo | voice-agent |

## Onboard a New Project

1. Design team pushes React project to GitHub
2. Create voice-agent branch, add `server/` directory with voice integration
3. Copy Dockerfiles from `templates/`
4. Create `projects/<name>.yml` (see existing configs)
5. Run: `./scripts/onboard-project.sh projects/<name>.yml`

## Scripts

| Script | Purpose |
|--------|---------|
| `onboard-project.sh` | Add a new project to Coolify |
| `update-all.sh` | Bump voice-agent-kit in all project repos |
| `backup-coolify.sh` | Export Coolify config for disaster recovery |

## Setup

Copy `.env.example` to `.env` and fill in:

```bash
COOLIFY_URL=https://coolify.singlewindow.dev
COOLIFY_TOKEN=<your-api-token>
GITHUB_APP_UUID=<from-coolify-sources>
SERVER_UUID=<from-coolify-servers>
```

Shared env vars for all projects go in `.env.shared`.
```

- [ ] **Step 2: Create .env.example for the repo itself**

Create `.env.example`:

```bash
# Coolify API
COOLIFY_URL=https://coolify.singlewindow.dev
COOLIFY_TOKEN=
GITHUB_APP_UUID=
SERVER_UUID=

# Find SERVER_UUID: curl -H "Authorization: Bearer $COOLIFY_TOKEN" $COOLIFY_URL/api/v1/servers | jq '.[].uuid'
# Find GITHUB_APP_UUID: check Coolify UI → Sources → GitHub App
```

- [ ] **Step 3: Create .env.shared.example**

Create `.env.shared.example`:

```bash
GROQ_API_KEY=
KYUTAI_STT_URL=
QWEN3_TTS_URL=
POCKET_TTS_URL=
```

- [ ] **Step 4: Create .gitignore**

Create `.gitignore`:

```
.env
.env.shared
```

- [ ] **Step 5: Commit and push**

```bash
git add README.md .env.example .env.shared.example .gitignore
git commit -m "docs: add README, env examples, and gitignore"
git push -u origin main
```

---

## Chunk 4: Onboard Existing Projects

### Task 10: Stop the manually deployed Kenya containers

The Kenya project is currently running via manual `docker compose up` on port 4210. Once Coolify manages it, the old containers need to go.

- [ ] **Step 1: Find and stop the old Kenya containers**

Run:
```bash
ssh singlewindow "docker compose -f /path/to/kenya/docker-compose.yml down"
```

Note: First find the compose file location:
```bash
ssh singlewindow "docker inspect kenya-agent-frontend-1 --format '{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}'"
```

- [ ] **Step 2: Verify port 4210 is free**

Run:
```bash
ssh singlewindow "ss -tlnp | grep 4210"
```

Expected: No output (port is free).

---

### Task 11: Onboard Kenya via Coolify UI

Since this is the first project and the API scripts may need tuning, onboard Kenya manually through Coolify UI first. This validates the workflow before automating the rest.

- [ ] **Step 1: Create project in Coolify**

In Coolify UI: Projects → Add New → Name: `kenya`, Description: `Kenya eCitizen services voice assistant`

- [ ] **Step 2: Add application**

In the Kenya project → Add New Resource → Application → GitHub → select `celiaaivalioti/Kenyaservices`

Configure:
- Branch: `voice-agent-refactor`
- Build Pack: Docker Compose
- Docker Compose Location: `/docker-compose.yml`

- [ ] **Step 3: Set domain**

In application settings: Domain → `https://kenya.singlewindow.dev`

- [ ] **Step 4: Set environment variables**

Add the following env vars in the application's Environment section:

Shared vars:
- `GROQ_API_KEY` = (value from existing server/.env)
- `KYUTAI_STT_URL` = (value from existing server/.env)
- `QWEN3_TTS_URL` = (value from existing server/.env)
- `POCKET_TTS_URL` = (value from existing server/.env)

Per-project vars:
- `CLIENT_API_KEY` = (value from existing server/.env)
- `CORS_ORIGIN` = `https://kenya.singlewindow.dev`

- [ ] **Step 5: Deploy**

Click Deploy. Monitor the build logs in Coolify UI.

Expected: Both frontend and backend containers start. Traefik automatically provisions SSL.

- [ ] **Step 6: Verify the deployment**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}" https://kenya.singlewindow.dev
```

Expected: `200`

Run:
```bash
curl -s https://kenya.singlewindow.dev/api/health
```

Expected: Health check response from the Express backend.

---

### Task 12: Onboard Bhutan and Licenses

Once Kenya is verified, onboard the remaining two projects. Use either the Coolify UI (repeating Task 11 steps) or the onboard script.

- [ ] **Step 1: Onboard Bhutan**

Using the script (if `.env` is configured):
```bash
./scripts/onboard-project.sh projects/bhutan.yml
```

Or repeat Task 11 steps in Coolify UI with:
- Repo: `celiaaivalioti/Bhutanephyto`
- Branch: `feat/multi-voice-support`
- Domain: `bhutan.singlewindow.dev`

- [ ] **Step 2: Deploy and verify Bhutan**

```bash
curl -s -o /dev/null -w "%{http_code}" https://bhutan.singlewindow.dev
```

Expected: `200`

- [ ] **Step 3: Onboard Licenses**

```bash
./scripts/onboard-project.sh projects/licenses.yml
```

Or repeat Task 11 steps with:
- Repo: `celiaaivalioti/Licenseportaldemo`
- Branch: `voice-agent`
- Domain: `licenses.singlewindow.dev`

- [ ] **Step 4: Deploy and verify Licenses**

```bash
curl -s -o /dev/null -w "%{http_code}" https://licenses.singlewindow.dev
```

Expected: `200`

- [ ] **Step 5: Verify all three projects**

Run:
```bash
for domain in kenya bhutan licenses; do
  echo -n "$domain.singlewindow.dev: "
  curl -s -o /dev/null -w "%{http_code}" "https://$domain.singlewindow.dev"
  echo ""
done
```

Expected:
```
kenya.singlewindow.dev: 200
bhutan.singlewindow.dev: 200
licenses.singlewindow.dev: 200
```

---

### Task 13: Enable auto-deploy webhooks

- [ ] **Step 1: Enable webhooks for all three projects**

In Coolify UI for each application: Settings → General → enable "Auto Deploy" (webhook-based).

This creates a webhook on each GitHub repo. Pushes to the configured branch trigger automatic rebuild and deploy.

- [ ] **Step 2: Test auto-deploy**

Make a trivial change to Kenya's `voice-agent-refactor` branch (e.g., update a comment), push it, and verify Coolify starts a build automatically.

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Kenyaservices
echo "<!-- auto-deploy test -->" >> public/index.html
git add public/index.html
git commit -m "test: verify Coolify auto-deploy"
git push
```

Watch Coolify UI → Deployments. A new deployment should appear within 30 seconds.

- [ ] **Step 3: Revert the test commit**

```bash
cd /Users/moulaymehdi/PROJECTS/figma/Kenyaservices
git revert HEAD --no-edit
git push
```

---

### Task 14: Run backup and final commit

- [ ] **Step 1: Configure .env in singlewindow-deployments**

```bash
cd singlewindow-deployments
cp .env.example .env
# Fill in COOLIFY_TOKEN, GITHUB_APP_UUID, SERVER_UUID
```

- [ ] **Step 2: Run the backup script**

```bash
./scripts/backup-coolify.sh
```

Expected: `coolify/projects.json`, `coolify/applications.json`, `coolify/servers.json` created.

- [ ] **Step 3: Commit the backup**

```bash
git add coolify/
git commit -m "chore: initial Coolify config backup"
git push
```
