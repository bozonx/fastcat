# Деплой веб-версии на Cloudflare

FastCat — статическое SPA (`ssr: false`, Nitro preset `static`). Сборка
`pnpm generate` создаёт `.output/public`, который раздаётся Cloudflare Worker-ом.

## Архитектура

- **`wrangler.toml`** — конфиг Worker-а: раздаёт статику из `.output/public`
  через `ASSETS` binding, SPA-fallback для client-side routing.
- **`worker/index.ts`** — проставляет cross-origin isolation заголовки
  (`COOP`, `COEP`, `CORP`) на каждый ответ. Они нужны для `SharedArrayBuffer`
  (coordinated I/O budget, WASM threads). Без них веб-версия не работает.
- **`public/_headers`** — тот же набор заголовков для Cloudflare Pages / Netlify
  (Worker этот файл игнорирует).
- Worker ставит `Cache-Control: immutable` для `/_nuxt/` и `/fonts/`.

## Предварительные требования

1. `pnpm install` — зависимости установлены.
2. Аккаунт Cloudflare.

## Шаг 1. Авторизация

```bash
npx wrangler login
```

Откроется браузер для входа. Проверка:

```bash
npx wrangler whoami
```

Для CI/CD используйте API-токен:

```bash
export CLOUDFLARE_API_TOKEN="ваш-токен"
```

Токен: Cloudflare Dashboard → My Profile → API Tokens. Нужны права:
- **Account** → Workers Scripts → Edit
- **Zone** → Workers Routes → Edit (для кастомного домена)

## Шаг 2. Env-переменные (опционально)

Если используются интеграции, задайте URL-ы до сборки:

```bash
export NUXT_PUBLIC_BLOGGER_DOG_API_URL="https://api.bloggerdog.com"
export NUXT_PUBLIC_BLOGGER_DOG_UI_URL="https://bloggerdog.com"
export NUXT_PUBLIC_FASTCAT_ACCOUNT_API_URL="https://api.fastcat.app"
export NUXT_PUBLIC_FASTCAT_ACCOUNT_UI_URL="https://fastcat.app"
```

Значения вшиваются в статику во время `pnpm generate`.

Feature-флаги:

```bash
export FASTCAT_ENABLE_PREMIUM_FEATURES=true
export FASTCAT_ENABLE_IN_DEVELOPMENT_FEATURES=false
```

## Шаг 3. Автоматический деплой через Cloudflare Git Integration (Dashboard)

В Cloudflare Dashboard (**Workers & Pages → Create / Import from Git**):
- **Build command**: `pnpm build:cf` (запускает `pnpm check:ui && pnpm generate` — сначала проверяет тесты/типы, затем собирает SPA)
- **Deploy command**: `npx wrangler deploy`

Любые ошибки линтера, типов или тестов отменят деплой автоматически.

## Шаг 4. Ручной деплой через CLI

```bash
pnpm deploy:cf
```

Запускает `pnpm generate && wrangler deploy`:
1. `pnpm generate` — собирает статику в `.output/public`
2. `wrangler deploy` — загружает Worker + ассеты в Cloudflare

URL после деплоя: `https://fastcat.<субдомен>.workers.dev`

## Локальный preview

```bash
pnpm preview:cf
```

Запускает `wrangler dev` с собранными ассетами — Worker работает локально
с теми же заголовками, что и в продакшене.

## Кастомный домен (опционально)

Добавьте в `wrangler.toml`:

```toml
routes = [
  { pattern = "fastcat.example.com", custom_domain = true }
]
```

После `pnpm deploy:cf` Cloudflare создаст DNS-запись и SSL-сертификат
автоматически.

## Troubleshooting

### SharedArrayBuffer недоступен

Проверьте, что Worker отдаёт заголовки:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

В DevTools → Console: `self.crossOriginIsolated` должно быть `true`.

### 404 на маршрутах

Worker настроен как SPA (`not_found_handling = "single-page-application"`),
все неизвестные маршруты отдаются как `index.html`. Если 404 всё равно
появляется — убедитесь что `run_worker_first = true` в `wrangler.toml`.

### Ассеты не обновляются

Hashed-ассеты в `/_nuxt/` кэшируются на год (`immutable`). При новом деплое
хеши меняются, поэтому старый кэш не мешает. Если нужно сбросить кэш —
Cloudflare Dashboard → Caching → Purge Everything.
