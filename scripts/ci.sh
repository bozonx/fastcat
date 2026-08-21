#!/usr/bin/env bash
set -euo pipefail

# CI entrypoint — run one test tier. Keeps the GitHub Actions YAML thin: each
# job calls `bash scripts/ci.sh <tier>` so the tier→command mapping lives in the
# repo (runnable locally, reviewable in one place) instead of scattered in YAML.
#
# Tiers (see README "Testing") — each maps to one CI job, kept non-overlapping:
#   static          typecheck + lint + format + i18n  (host, fast, blocking)
#   unit            web unit + component tests        (host, fast, blocking)
#   integration-web web integration                   (host, blocking)
#   native          Rust unit + integration + parity   (host, blocking)
#   e2e-smoke       Playwright smoke tier             (Docker, blocking)
#   e2e             Playwright full UI e2e            (Docker, blocking)
#   golden-web      web rendered-frame golden         (Docker, GPU, non-gate)
#   golden-native   native rendered-frame golden      (host, GPU, non-gate)
#
# The golden tiers compare real GPU output against shared/golden and are GPU-
# fragile under SwiftShader, so they are not wired into CI. They set
# REQUIRE_WEBGPU / REQUIRE_TEST_DEPS so a *missing* adapter fails loudly (a
# green run must have actually rendered), while a genuine pixel mismatch is the
# expected, reported outcome. Run them manually when GPU is available.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TIER="${1:-}"

case "$TIER" in
  static)
    pnpm check:static
    ;;
  unit)
    pnpm test:unit
    ;;
  integration-web)
    pnpm test:integration:web
    ;;
  native)
    pnpm test:native
    ;;
  e2e-smoke)
    bash scripts/e2e-docker.sh test:e2e:smoke
    ;;
  e2e)
    bash scripts/e2e-docker.sh test:e2e
    ;;
  golden-web)
    REQUIRE_WEBGPU=1 bash scripts/e2e-docker.sh test:golden:web
    ;;
  golden-native)
    REQUIRE_TEST_DEPS=1 pnpm test:golden:native
    ;;
  *)
    echo "Usage: bash scripts/ci.sh <static|unit|integration-web|native|e2e-smoke|e2e|golden-web|golden-native>" >&2
    exit 2
    ;;
esac
