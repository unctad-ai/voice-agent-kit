#!/usr/bin/env bash
set -euo pipefail

# Link voice-agent-kit packages from a worktree into a local Swkenya deployment.
# Usage: ./autotune/link-to-swkenya.sh [swkenya_path]
#
# Swkenya uses npm (not pnpm), so we need to:
# 1. Patch package.json main fields to point to dist/ (npm link reads main)
# 2. Replace workspace:* with * (pnpm protocol doesn't resolve via npm)
# 3. Link in correct order (registries first — core depends on it)

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SWKENYA_ROOT="${1:-$(cd "$KIT_ROOT/.." && pwd)/Swkenya}"

echo "Kit root:     $KIT_ROOT"
echo "Swkenya root: $SWKENYA_ROOT"

# Step 1: Patch publishConfig into main fields
echo "Patching package.json main fields for npm link..."
for pkg in core registries server ui; do
  cd "$KIT_ROOT/packages/$pkg"
  node -e "
    const p = require('./package.json');
    if (p.publishConfig) {
      if (p.publishConfig.main) p.main = p.publishConfig.main;
      if (p.publishConfig.types) p.types = p.publishConfig.types;
      if (p.publishConfig.exports) p.exports = p.publishConfig.exports;
    }
    require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  "
done

# Step 2: Patch workspace:* references
echo "Patching workspace:* references..."
for pkg in core registries server ui; do
  cd "$KIT_ROOT/packages/$pkg"
  node -e "
    const p = require('./package.json');
    for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
      for (const k in p[section] || {}) {
        if (p[section][k] === 'workspace:*') p[section][k] = '*';
      }
    }
    require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  "
done

# Step 3: npm link in correct order (registries first for circular dep)
echo "Registering npm links..."
cd "$KIT_ROOT/packages/registries" && npm link
cd "$KIT_ROOT/packages/core" && npm link
cd "$KIT_ROOT/packages/ui" && npm link
cd "$KIT_ROOT/packages/server" && npm link

# Step 4: Link into Swkenya
echo "Linking into Swkenya root..."
cd "$SWKENYA_ROOT"
npm link @unctad-ai/voice-agent-core @unctad-ai/voice-agent-ui @unctad-ai/voice-agent-registries

echo "Linking into Swkenya server..."
cd "$SWKENYA_ROOT/server"
npm link @unctad-ai/voice-agent-server @unctad-ai/voice-agent-core

# Step 5: Verify
echo ""
echo "Verifying links..."
ls -la "$SWKENYA_ROOT/node_modules/@unctad-ai/" 2>/dev/null | grep "^l" || echo "WARNING: No symlinks found in Swkenya root"
ls -la "$SWKENYA_ROOT/server/node_modules/@unctad-ai/" 2>/dev/null | grep "^l" || echo "WARNING: No symlinks found in Swkenya server"

echo ""
echo "Done. To undo: ./autotune/unlink-from-swkenya.sh"
