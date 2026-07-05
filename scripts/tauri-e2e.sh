#!/usr/bin/env bash
set -euo pipefail

# Run the Tauri (WebKitGTK) e2e suite on Linux via the official tauri-driver path.
#
#   wdio  ->  tauri-driver  ->  WebKitWebDriver  ->  built FastCat binary
#
# Usage:
#   bash scripts/tauri-e2e.sh            # build if needed, then run all specs
#   FORCE_BUILD=1 bash scripts/tauri-e2e.sh   # force a release rebuild first

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export E2E_TEST=1

BIN="src-tauri/target/release/fastcat"
TAURI_DRIVER="${TAURI_DRIVER_PATH:-$HOME/.cargo/bin/tauri-driver}"

echo "==> Checking prerequisites"
command -v WebKitWebDriver >/dev/null 2>&1 || {
  echo "ERROR: WebKitWebDriver not found on PATH."
  echo "       Install it (Debian/Ubuntu: 'webkit2gtk-driver', Arch: 'webkitgtk-6.0')."
  exit 1
}
[ -x "$TAURI_DRIVER" ] || {
  echo "ERROR: tauri-driver not found at $TAURI_DRIVER"
  echo "       Install it: 'cargo install tauri-driver --locked'"
  exit 1
}

if [ "${FORCE_BUILD:-0}" = "1" ] || [ ! -x "$BIN" ]; then
  echo "==> Building release binary (pnpm tauri build --no-bundle)"
  pnpm tauri build --no-bundle
fi

echo "==> Running Tauri e2e (wdio)"
pnpm exec wdio run test/tauri-e2e/wdio.conf.ts "$@"
