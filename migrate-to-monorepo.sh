#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "🚀 Начинаем реструктуризацию монорепозитория Turborepo..."

# 1. Создаем структуру директорий под apps/ и packages/
echo "📁 Создаем каталоги apps/ и packages/..."
mkdir -p apps/web apps/native apps/worker apps/docs \
         packages/shared packages/typescript-config packages/eslint-config

# 2. Переносим веб-приложение (@fastcat/web)
echo "📦 Переносим @fastcat/web..."
[ -d src ] && git mv src apps/web/src
[ -d public ] && git mv public apps/web/public
[ -d test ] && git mv test apps/web/test
[ -f nuxt.config.ts ] && git mv nuxt.config.ts apps/web/nuxt.config.ts
[ -f vitest.config.ts ] && git mv vitest.config.ts apps/web/vitest.config.ts
[ -f playwright.config.ts ] && git mv playwright.config.ts apps/web/playwright.config.ts
[ -f .nuxtrc ] && git mv .nuxtrc apps/web/.nuxtrc
[ -d dev ] && git mv dev apps/web/dev

# 3. Переносим нативный клиент Desktop + Mobile (@fastcat/native)
echo "📦 Переносим @fastcat/native..."
[ -d src-tauri ] && git mv src-tauri apps/native/src-tauri

# 4. Переносим Cloudflare Worker (@fastcat/worker)
echo "📦 Переносим @fastcat/worker..."
if [ -d worker ]; then
  [ -f worker/index.ts ] && git mv worker/index.ts apps/worker/index.ts
  [ -f worker/tsconfig.json ] && git mv worker/tsconfig.json apps/worker/tsconfig.json
  rmdir worker 2>/dev/null || true
fi
[ -f wrangler.toml ] && git mv wrangler.toml apps/worker/wrangler.toml

# 5. Переносим документационный сайт (@fastcat/docs)
echo "📦 Переносим @fastcat/docs..."
if [ -d landing-doc-site ]; then
  [ -d landing-doc-site/src ] && git mv landing-doc-site/src apps/docs/src
  rmdir landing-doc-site 2>/dev/null || true
fi

# 6. Переносим общий слой шейдеров и фикстур (@fastcat/shared)
echo "📦 Переносим @fastcat/shared..."
if [ -d shared ]; then
  [ -d shared/effects ] && git mv shared/effects packages/shared/effects
  [ -d shared/golden ] && git mv shared/golden packages/shared/golden
  [ -d shared/parity ] && git mv shared/parity packages/shared/parity
  [ -d shared/scenes ] && git mv shared/scenes packages/shared/scenes
  [ -d shared/transitions ] && git mv shared/transitions packages/shared/transitions
  rmdir shared 2>/dev/null || true
fi

echo "✅ Все файлы и папки успешно перемещены в структуру Turborepo!"
