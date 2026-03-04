#!/usr/bin/env bash
set -euo pipefail

PACKAGES=(core registries ui server)

# 1. Clean build
rm -rf packages/*/dist
pnpm build

# 2. Verify dist/ outputs
for pkg in "${PACKAGES[@]}"; do
  for file in dist/index.js dist/index.d.ts; do
    test -f "packages/$pkg/$file" || { echo "FAIL: packages/$pkg/$file missing"; exit 1; }
  done
done

# 3. Dry-run publish (pnpm resolves workspace: protocol at publish time)
for pkg in "${PACKAGES[@]}"; do
  (cd "packages/$pkg" && pnpm publish --dry-run --no-git-checks)
done

echo "All validations passed."
