#!/usr/bin/env bash
set -euo pipefail

# Undo npm links and restore Swkenya to registry packages.
# Usage: ./autotune/unlink-from-swkenya.sh [swkenya_path]

KIT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SWKENYA_ROOT="${1:-$(cd "$KIT_ROOT/.." && pwd)/Swkenya}"

echo "Unlinking from Swkenya root..."
cd "$SWKENYA_ROOT"
npm unlink --no-save @unctad-ai/voice-agent-core @unctad-ai/voice-agent-ui @unctad-ai/voice-agent-registries 2>/dev/null || true

echo "Unlinking from Swkenya server..."
cd "$SWKENYA_ROOT/server"
npm unlink --no-save @unctad-ai/voice-agent-server @unctad-ai/voice-agent-core 2>/dev/null || true

echo "Restoring Swkenya dependencies..."
cd "$SWKENYA_ROOT" && npm install
cd "$SWKENYA_ROOT/server" && npm install

echo "Restoring kit package.json files..."
cd "$KIT_ROOT" && git checkout -- packages/*/package.json

echo "Done. Swkenya is back on registry packages."
