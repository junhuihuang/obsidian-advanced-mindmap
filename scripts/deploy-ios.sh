#!/usr/bin/env bash
# Build the plugin and serve a zip of main.js + styles.css over the LAN so an
# iPhone (on the same Wi-Fi) can download and install them via the Files app.
#
# Usage:
#   scripts/deploy-ios.sh          # auto-detect LAN IP, port 8090
#   IP=192.168.1.50 PORT=8080 scripts/deploy-ios.sh
#
# On the iPhone:
#   1. Scan the QR code (or type the URL) in Safari → it downloads the zip.
#   2. Open the zip in the Files app and unzip it.
#   3. Copy main.js and styles.css into:
#        <your vault>/.obsidian/plugins/advanced-mindmap/
#   4. Restart Obsidian (or reload the plugin) and check the mindmap.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8090}"
IP="${IP:-$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[0-9.]+' | grep -v '^127\.' | head -1)}"
ZIP_NAME="advanced-mindmap.zip"

if [ -z "${IP:-}" ]; then
  echo "Could not detect a LAN IP; set one explicitly, e.g. IP=192.168.1.50 $0" >&2
  exit 1
fi

echo "==> Building..."
npm run build

TMP="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

cp main.js styles.css "$TMP/"
(cd "$TMP" && zip -q -j "$ZIP_NAME" main.js styles.css)

URL="http://$IP:$PORT/$ZIP_NAME"

echo
echo "==> On your iPhone (same Wi-Fi), open Safari and visit:"
echo "    $URL"
echo
if command -v qrencode >/dev/null 2>&1; then
  qrencode -t UTF8 -m 2 "$URL"
else
  echo "(install 'qrencode' to get a scannable QR code)"
fi

echo
echo "==> Serving on $URL  (Ctrl+C to stop)"
python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$TMP" >/dev/null 2>&1 &
SERVER_PID=$!
wait "$SERVER_PID"
