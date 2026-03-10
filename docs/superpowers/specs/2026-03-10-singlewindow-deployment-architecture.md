# Single Window Deployment Architecture

**Domain:** singlewindow.dev
**Server:** 157.180.127.65 / 2a01:4f9:c013:f8af::1 (16GB RAM, 8 vCPU, 300GB disk)
**Platform:** Coolify (self-hosted PaaS with Traefik + auto Let's Encrypt)

---

## Context

Voice agent demo projects follow a repeating pattern:
1. Design team creates a Figma → React project and pushes to GitHub
2. Our team creates a voice-agent branch, adds Express backend + voice integration
3. Project deploys to the singlewindow server

Each project is structurally identical: Vite+React frontend (nginx), Express backend using `createVoiceRoutes()` from `@unctad-ai/voice-agent-kit`, Docker Compose with 2 containers. The only differences are `SiteConfig`, optional `extraServerTools`, and branding.

With 5-15 projects expected, manual deployment (SSH, docker compose up, nginx config, certbot) doesn't scale.

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │        Single Window Server              │
                    │                                       │
Internet ──▶ :80/443 ──▶ Traefik (managed by Coolify)      │
                    │        │                              │
                    │        ├─▶ kenya.singlewindow.dev     │
                    │        │    ├─ frontend (nginx)       │
                    │        │    └─ backend  (express)     │
                    │        │                              │
                    │        ├─▶ bhutan.singlewindow.dev    │
                    │        │    ├─ frontend (nginx)       │
                    │        │    └─ backend  (express)     │
                    │        │                              │
                    │        ├─▶ licenses.singlewindow.dev  │
                    │        │    ├─ frontend (nginx)       │
                    │        │    └─ backend  (express)     │
                    │        │                              │
                    │        └─▶ (future projects...)       │
                    │                                       │
                    │   Shared: pocket-tts container        │
                    │                                       │
                    │   coolify.singlewindow.dev → Coolify  │
                    └──────────────────────────────────────┘
```

- Traefik routes by domain, handles SSL auto-renewal via Let's Encrypt
- Coolify connects to each GitHub repo and auto-deploys on push
- Wildcard DNS (`*.singlewindow.dev`) eliminates per-project DNS changes

## Deployment Repo: singlewindow-deployments

```
singlewindow-deployments/
├── README.md                    # How to onboard a new project
├── coolify/
│   └── coolify-config.json      # Exported Coolify config (backup)
├── scripts/
│   ├── onboard-project.sh       # Add a new voice-agent project
│   ├── update-all.sh            # Bump voice-agent-kit across all projects
│   └── backup-coolify.sh        # Export Coolify config to repo
├── templates/
│   ├── docker-compose.yml       # Standard compose template for new projects
│   ├── Dockerfile.frontend      # Standardized frontend Dockerfile
│   ├── server/Dockerfile        # Standardized backend Dockerfile
│   └── .env.example             # Required env vars with docs
└── projects/
    ├── kenya.yml                 # Per-project overrides (domain, branch, repo)
    ├── bhutan.yml
    └── licenses.yml
```

## Shared vs Per-Project Resources

### Shared (one instance, all projects use):
| Resource | Details |
|----------|---------|
| pocket-tts | TTS fallback container |
| GROQ_API_KEY | LLM provider key |
| KYUTAI_STT_URL | Speech-to-text endpoint |
| QWEN3_TTS_URL | Text-to-speech endpoint |
| POCKET_TTS_URL | Fallback TTS endpoint |

Shared env vars are set at the Coolify project level (inherited by all services).

### Per-project:
| Variable | Example |
|----------|---------|
| CLIENT_API_KEY | Unique per project |
| CORS_ORIGIN | `https://kenya.singlewindow.dev` |
| VITE_COPILOT_NAME | `Pesa` (Kenya), `ePhyto` (Bhutan) |
| VITE_BACKEND_URL | `https://kenya.singlewindow.dev` |

## Current Projects

| Project | GitHub Repo | Branch | Domain |
|---------|-------------|--------|--------|
| Kenyaservices | celiaaivalioti/Kenyaservices | voice-agent-refactor | kenya.singlewindow.dev |
| Bhutanephyto | celiaaivalioti/Bhutanephyto | feat/multi-voice-support | bhutan.singlewindow.dev |
| Licenseportaldemo | celiaaivalioti/Licenseportaldemo | voice-agent | licenses.singlewindow.dev |

## Deployment Workflows

### Onboarding a new project

```
1. Design team pushes React project to GitHub
2. Your team creates voice-agent branch:
   ├── Add server/ (Express + voice-config.ts)
   ├── Copy Dockerfiles from templates/
   └── Push
3. Run: ./scripts/onboard-project.sh
   ├── Prompts for: repo URL, branch, domain, copilot name
   ├── Creates projects/<name>.yml
   ├── Calls Coolify API to create project, set repo/branch/env/domain
   └── Commits config to singlewindow-deployments repo
4. Coolify builds & deploys → live at <name>.singlewindow.dev
```

### Ongoing updates

| Scenario | What happens |
|----------|-------------|
| Design team pushes to voice-agent branch | Coolify webhook → auto-rebuild → live in ~2 min |
| Bump voice-agent-kit version | `./scripts/update-all.sh` → updates package.json in all repos → Coolify auto-deploys |
| Rollback | Coolify UI or API → one-click rollback to previous deployment |

## DNS Setup (one-time, completed)

| Type | Name | Value |
|------|------|-------|
| A | `*` | 157.180.127.65 |
| AAAA | `*` | 2a01:4f9:c013:f8af::1 |
| A | `@` | 157.180.127.65 |
| AAAA | `@` | 2a01:4f9:c013:f8af::1 |

## SSL

Handled automatically by Traefik (via Coolify):
- Requests Let's Encrypt certificate per domain on first request
- Auto-renews before expiry
- HTTP → HTTPS redirect by default
- Zero manual certificate management

## Decisions

1. **Coolify over raw Docker Compose** — auto-deploy on GitHub push, web UI, built-in SSL, deployment history, rollback
2. **singlewindow.dev domain** — clean branding for demos, wildcard DNS
3. **Build on the singlewindow server** — simpler than CI/CD pipeline, acceptable for demo scale
4. **Shared TTS/STT containers** — one pocket-tts instance serving all projects, GPU endpoints shared via env vars
5. **Central singlewindow-deployments repo** — version-controlled Coolify config, automation scripts, templates, disaster recovery
