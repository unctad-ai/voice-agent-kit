#!/usr/bin/env bash
# release.sh — Create changeset, bump versions, validate, tag, and push.
# CI (publish.yml) handles npm publish on v* tags.
#
# Usage: ./scripts/release.sh [patch|minor] [--yes]
#   patch  — bugfix (0.1.2 → 0.1.3)   [default]
#   minor  — feature (0.1.2 → 0.2.0)
#   --yes  — skip confirmation (AI-friendly)
#
# Prerequisites: pnpm, gh (optional, for GitHub release)

set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PACKAGES=(core registries ui server)

# --- Helpers ---

get_version() {
  node -p "require('./packages/core/package.json').version"
}

check_deps() {
  command -v pnpm &>/dev/null || { echo -e "${RED}pnpm not found${NC}"; exit 1; }
}

pre_release_checks() {
  echo -e "${BLUE}Pre-release checks...${NC}"

  echo "  Checking branch..."
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$branch" != "main" ]]; then
    echo -e "${RED}Must release from main (currently on $branch)${NC}"
    exit 1
  fi

  echo "  Checking for uncommitted changes..."
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo -e "${RED}Uncommitted changes found. Commit or stash first.${NC}"
    exit 1
  fi

  echo "  Pulling latest..."
  git pull --ff-only origin main

  echo "  Running typecheck..."
  if ! pnpm typecheck >/dev/null 2>&1; then
    echo -e "${RED}Typecheck failed. Run 'pnpm typecheck' to see errors.${NC}"
    exit 1
  fi

  echo -e "${GREEN}  ✓ All checks passed${NC}"
  echo ""
}

# --- Main ---

main() {
  local auto_confirm=false
  local bump_type="patch"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -y|--yes) auto_confirm=true; shift ;;
      patch|minor) bump_type="$1"; shift ;;
      *) echo "Usage: $0 [patch|minor] [--yes]"; exit 1 ;;
    esac
  done

  check_deps
  pre_release_checks

  local current_version
  current_version=$(get_version)

  # Check for pending changesets
  local has_changeset=false
  for f in .changeset/*.md; do
    [[ "$f" == ".changeset/README.md" ]] && continue
    [[ -f "$f" ]] && has_changeset=true && break
  done

  if [[ "$has_changeset" == false ]]; then
    echo -e "${YELLOW}No changeset found. Creating one...${NC}"
    if [[ "$auto_confirm" == true ]]; then
      echo -e "${RED}Cannot auto-create changeset. Run 'pnpm changeset' first.${NC}"
      exit 1
    fi
    pnpm changeset
  fi

  # Bump versions via changesets
  echo -e "${BLUE}Running changeset version...${NC}"
  pnpm release

  local new_version
  new_version=$(get_version)

  echo ""
  echo -e "${YELLOW}Current:${NC} $current_version"
  echo -e "${GREEN}New:${NC}     $new_version"
  echo ""

  # Show what changed
  echo -e "${BLUE}Changes since v$current_version:${NC}"
  echo "─────────────────────────────────────────"
  git log "v$current_version"..HEAD --oneline 2>/dev/null || git log --oneline -10
  echo "─────────────────────────────────────────"
  echo ""

  # Confirm
  if [[ "$auto_confirm" != true ]]; then
    read -p "Release v$new_version? [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || { echo "Aborted."; git checkout -- .; exit 0; }
  fi

  # Commit, tag, push
  echo "Committing..."
  git add -A
  git commit -m "chore: release v$new_version"

  echo "Tagging v$new_version..."
  git tag -a "v$new_version" -m "Release v$new_version"

  echo "Pushing..."
  git push origin main
  git push origin "v$new_version"

  # Create GitHub release (optional)
  if command -v gh &>/dev/null; then
    echo "Creating GitHub release..."
    local changelog=""
    for f in packages/*/CHANGELOG.md; do
      [[ -f "$f" ]] || continue
      # Extract latest version section
      local section
      section=$(awk "/^## $new_version/{found=1;next} /^## [0-9]/{if(found)exit} found" "$f")
      [[ -n "$section" ]] && changelog+="### $(basename "$(dirname "$f")")"$'\n'"$section"$'\n\n'
    done
    echo "$changelog" | gh release create "v$new_version" --title "v$new_version" --notes-file - || true
  fi

  echo ""
  echo -e "${GREEN}✓ Released v$new_version${NC}"
  echo "  CI will publish to npm: https://github.com/unctad-ai/voice-agent-kit/actions"
}

main "$@"
