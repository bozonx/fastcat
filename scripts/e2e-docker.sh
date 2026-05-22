#!/usr/bin/env bash
set -euo pipefail

# Run Playwright e2e tests inside the Docker container.
# Any extra arguments are forwarded to `pnpm test:e2e`.
#
# Usage:
#   bash scripts/e2e-docker.sh
#   bash scripts/e2e-docker.sh -- test/e2e/smoke

EXTRA_ARGS="${*:-}"

echo "==> Starting e2e tests in Docker (extra args: ${EXTRA_ARGS:-none})"

docker compose --profile e2e run --rm playwright sh -c \
  "corepack enable && pnpm install --frozen-lockfile && pnpm test:e2e ${EXTRA_ARGS}"

echo "==> Fixing artifact permissions created by root inside the container..."
docker run --rm \
  -v "$(pwd):/app" \
  busybox \
  chown -R "$(id -u):$(id -g)" /app/test-results /app/playwright-report \
  2>/dev/null || true

echo "==> Done"
