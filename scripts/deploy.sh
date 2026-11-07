#!/usr/bin/env bash
# Build the plugin and install it into the local Obsidian vault, so the changes
# are live there after reloading the plugin.
#
# Usage:
#   npm run deploy
#   VAULT=/path/to/vault npm run deploy
#   PLUGIN_DIR=/path/to/.obsidian/plugins/advanced-mindmap npm run deploy
#
# data.json (the plugin's saved settings) is deliberately left untouched.
set -euo pipefail

cd "$(dirname "$0")/.."

VAULT="${VAULT:-$HOME/vault}"
PLUGIN_DIR="${PLUGIN_DIR:-$VAULT/.obsidian/plugins/advanced-mindmap}"

if [ ! -d "$PLUGIN_DIR" ]; then
  echo "Plugin folder not found: $PLUGIN_DIR" >&2
  echo "Set VAULT=/path/to/vault or PLUGIN_DIR=/path/to/plugin to override." >&2
  exit 1
fi

echo "==> Building..."
npm run build

echo "==> Installing into $PLUGIN_DIR"
cp main.js styles.css manifest.json "$PLUGIN_DIR/"

echo
echo "Done. Reload Obsidian's Advanced Mindmap plugin to pick up the build"
echo "(Settings → Community plugins → toggle it off/on, or run 'Reload app without saving'"
echo "after enabling it once in a dev vault)."
