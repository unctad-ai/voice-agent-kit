# Post-Deployment Follow-ups

> **Context**: Chunk 5 (migration of Kenya, Bhutan, South Africa) is complete. Voice-agent-action works, kit v1.0.4 published. This plan covers remaining items.

## 1. Fix stale singlewindow-deployments configs

**Repo**: `/Users/moulaymehdi/PROJECTS/figma/singlewindow-deployments`

The `projects/*.yml` configs reference old repo names and branches. Coolify currently deploys from these — updating them will point Coolify at the new repos.

| File | Current | Fix to |
|------|---------|--------|
| `projects/kenya.yml` | `unctad-ai/Kenyaservices @ voice-agent-refactor` | `unctad-ai/Swkenya @ voice-agent` |
| `projects/bhutan.yml` | `unctad-ai/Bhutanephyto @ feat/multi-voice-support` | `unctad-ai/Swbhutan @ voice-agent` |
| `projects/licenses.yml` | `unctad-ai/Licenseportaldemo @ voice-agent` | Verify repo exists, update if renamed |

**Steps**:
1. Edit each YAML (repo + branch fields)
2. For each, call Coolify API to update the app:
   ```bash
   source .env
   UUID=$(grep "^uuid:" projects/<name>.yml | sed 's/uuid: //')
   curl -sf -X PATCH "$COOLIFY_URL/api/v1/applications/$UUID" \
     -H "Authorization: Bearer $COOLIFY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"git_repository": "unctad-ai/Sw<country>", "git_branch": "voice-agent"}'
   ```
3. Trigger redeploy for each
4. Commit and push the YAML changes
5. Verify: `curl https://<domain>/api/health` returns 200

## 2. Provision Lesotho and South Africa to Coolify

**Skill**: `/provision-coolify`

Neither project exists in Coolify yet. The voice-agent branches are built and ready.

**Pre-requisite**: `.env` must exist in `singlewindow-deployments` with Coolify creds. If missing, SSH to `singlewindow` server and get `COOLIFY_TOKEN` from dashboard.

**For each (lesotho, southafrica)**:
1. Run `/provision-coolify` skill — it reads `.voice-agent.yml`, creates `projects/<name>.yml`, generates CLIENT_API_KEY, runs `onboard-project.sh`
2. Wait 3-5 min for first deploy
3. Verify: `curl https://<domain>.singlewindow.dev` and `/api/health`

## 3. Fix Bhutan and South Africa service data

**Problem**: `src/data/services.ts` in both repos' `main` branches contains Kenya services (agencies like KRA, DOSH, NEMA; currency KES). This is Figma Make upstream data — the projects were forked from Kenya without replacing the service catalog.

**Impact**: Users see Kenya services in the UI navigation. The voice agent's voice-config.ts faithfully mirrors this wrong data.

**Options**:
- **A) Designer fix** — Ask the Figma Make designer to update `services.ts` with real country data. Next push to `main` triggers the action, which rebuilds voice-agent with correct services.
- **B) Manual override** — Create correct `services.ts` data files and commit directly to `main` in each repo. Risk: Figma Make's next push may overwrite.
- **C) Action-level override** — Add a `services-override.ts` mechanism to the action that replaces upstream data. More complex but survives Figma Make pushes.

**Recommended**: Option A. If designer is unavailable, Option B as interim.

**Bhutan services** should include: BAFRA phytosanitary certificates, MoEA business registration, RICBL insurance, trade licenses.
**South Africa services** should include: CIPC company registration, SARS tax, DoEL workplace, DFFE environmental. Currency: ZAR.

## 4. Add form field hooks to Bhutan and South Africa

**Skill**: `/integrate-form-fields`

Both projects have zero `useProgressiveFields` calls. The voice agent can navigate and answer questions but cannot fill forms.

**Steps per project**:
1. Checkout `voice-agent` branch
2. Run `/integrate-form-fields` — it audits form components and adds hooks
3. Push to `voice-agent` branch
4. Coolify auto-deploys

**Note**: This should happen AFTER item 3 (service data fix), since form fields reference service-specific data.

## 5. Content hash edge case (optional)

**Problem**: When `main` is reverted to a previous state (e.g., undoing a bad merge), the content hash may match the previous run, causing Claude Code to be skipped. Restored files from the old voice-agent branch can be incompatible with the reverted main.

**Fix**: Include the kit version in the hash computation (in `action.yml` content hash step). This way, kit upgrades also invalidate the cache.

```bash
# In the content hash step, add:
HASH_INPUT="$HASH $(npm view @unctad-ai/voice-agent-core version 2>/dev/null || echo unknown)"
HASH=$(echo "$HASH_INPUT" | sha256sum | cut -d' ' -f1)
```

**Also consider**: adding scaffold.sh's own hash to the input, so template changes invalidate the cache too.

## 6. Fix macOS sed -i in onboard-project.sh (optional)

**File**: `/Users/moulaymehdi/PROJECTS/figma/singlewindow-deployments/scripts/onboard-project.sh` line 157

macOS `sed -i` requires `sed -i ''`. The script uses GNU syntax which fails on Mac.

**Fix**: `sed -i '' "s|^uuid:.*|uuid: $APP_UUID|" "$PROJECT_FILE"` or detect OS:
```bash
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s|^uuid:.*|uuid: $APP_UUID|" "$PROJECT_FILE"
else
  sed -i "s|^uuid:.*|uuid: $APP_UUID|" "$PROJECT_FILE"
fi
```

---

## Priority order

1. **Stale configs** (item 1) — current Coolify deploys point to wrong repos
2. **Provision Lesotho/SA** (item 2) — new deployments
3. **Service data** (item 3) — user-facing data quality
4. **Form hooks** (item 4) — voice agent capability
5. Content hash fix (item 5) — edge case prevention
6. sed fix (item 6) — developer convenience
