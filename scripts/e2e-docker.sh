#!/usr/bin/env bash
set -euo pipefail

# Run a Playwright test tier inside the Docker container (SwiftShader software
# GPU). The first argument is the pnpm script to run (default: test:e2e); any
# further arguments are forwarded to it.
#
# Usage:
#   bash scripts/e2e-docker.sh                      # -> pnpm test:e2e
#   bash scripts/e2e-docker.sh test:e2e:smoke       # smoke tier only
#   bash scripts/e2e-docker.sh test:golden:web      # golden (rendered-frame) tier
#   bash scripts/e2e-docker.sh test:e2e -- e2e/web/export.spec.ts

PNPM_SCRIPT="${1:-test:e2e}"
shift || true
EXTRA_ARGS="${*:-}"

echo "==> Running 'pnpm ${PNPM_SCRIPT} ${EXTRA_ARGS}' in Docker"

# Forward the "fail instead of skip" gates so a broken GPU in CI is loud.
docker compose --profile e2e run --rm \
  -e REQUIRE_WEBGPU \
  -e REQUIRE_TEST_DEPS \
  playwright sh -c \
  "corepack enable && pnpm install --frozen-lockfile && pnpm ${PNPM_SCRIPT} ${EXTRA_ARGS}"

echo "==> Fixing artifact permissions created by root inside the container..."
docker run --rm \
  -v "$(pwd):/app" \
  busybox \
  chown -R "$(id -u):$(id -g)" /app/test-results /app/playwright-report \
  2>/dev/null || true

echo "==> Done"
