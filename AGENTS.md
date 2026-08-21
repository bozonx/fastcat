# AI Agents Guidelines

## Tech Stack

- **Framework**: Nuxt 4 (Vue 3, Composition API, `<script setup>`)
- **State Management**: Pinia
- **Styling**: Tailwind CSS (v4)
- **Language**: TypeScript
- **Testing**: Vitest (Unit), Playwright (E2E)
- **Linting & Formatting**: ESLint, Prettier

## Monorepo Structure (Turborepo + pnpm workspaces)

The repository is organised as a Turborepo monorepo:

- `apps/web/` — Nuxt 4 web video editor application (`@fastcat/web`).
  - `apps/web/src/` — components, stores, utils, workers, timeline, locales, io.
  - `apps/web/public/` — static assets and vendored fonts (`/fonts/`).
  - `apps/web/test/` — web unit, component, integration, and e2e tests.
- `apps/native/` — Cross-platform Tauri v2 wrapper for Desktop & Mobile (`@fastcat/native`).
  - `apps/native/src-tauri/` — Rust compositor and media engine.
- `apps/worker/` — Cloudflare Worker serving static assets with COOP/COEP isolation headers (`@fastcat/worker`).
- `apps/docs/` — VitePress documentation and landing site (`@fastcat/docs`).
- `packages/embed/` — Embed SDK (`@bozonx/fastcat-embed`).
- `packages/shared/` — Cross-backend WGSL shaders and parity/golden fixtures (`@fastcat/shared`).
- `packages/typescript-config/` — Shared TypeScript configurations (`@fastcat/typescript-config`).
- `packages/eslint-config/` — Shared ESLint configuration (`@fastcat/eslint-config`).

## Testing Structure

Tests are organised into explicit **tiers** (one CI job each):

- **parity** = pure cross-language _logic_ math (`packages/shared/parity/*.json`, CPU) — lives in the unit/rust tiers, not a tier of its own.
- **golden** = cross-engine _rendered-frame_ comparison (`packages/shared/golden/frames.json`, GPU) — its own tier, kept out of the merge gate.

| Tier              | Directory                                                                                | Command                     |
| ----------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| Unit              | `apps/web/test/unit/` (incl. `*.parity.test.ts`), `apps/web/test/components/`            | `pnpm test:unit`            |
| Integration (web) | `apps/web/test/integration/` (incl. `golden-registry/`), `apps/web/test/golden-helpers/` | `pnpm test:integration:web` |
| Native (Rust)     | `apps/native/src-tauri/tests/`, Rust `#[test]`s (incl. logic parity)                     | `pnpm test:native`          |
| E2E — smoke       | `apps/web/test/e2e/smoke/`                                                               | `pnpm test:e2e:smoke`       |
| E2E — full        | `apps/web/test/e2e/web/`                                                                 | `pnpm test:e2e`             |
| Golden (rendered) | `apps/web/test/golden/`, `apps/native/src-tauri/tests/engine_parity.rs`                  | `pnpm test:golden`          |

- `test:integration:native` is a curated fast **subset** of `test:native` (the latter runs the whole Rust suite incl. logic parity + golden, skipping GPU gracefully).
- `pnpm test` runs all Vitest tiers in one pass; `pnpm check` runs everything incl. e2e/golden; `pnpm check:fast` is the quick static + unit + web-integration loop.
- CI tiers are dispatched by `scripts/ci.sh <tier>`. The current blocking gate in `.github/workflows/ci.yml` runs static, unit, web integration, and Rust tiers. Playwright tiers are intentionally deferred while their OOM issue is investigated; golden tiers are GPU-dependent and run manually.
- `apps/web/test/fixtures/` — Static assets and mock data for tests.
- `apps/web/test/vitest.setup.ts` — Global configuration and mocks for Vitest.

## General Principles

- Communication with the user is conducted in Russian (including plans and reasoning).
- Code, commits, JSDoc, variable and function names must be in English (except i18n).
- Write minimalist, readable code. Follow DRY and SOLID principles.
- If you find minor issues in a working file (typos, formatting) — fix them. For serious ones (vulnerabilities) — report them, but do not fix without a command.

## Engine Coupling Contract (web ↔ native)

The web (Pixi/WebGPU) and native (wgpu/vello) video engines are **separate paradigms**
with exactly two coupling surfaces:

- `packages/shared/*.wgsl` — the single source of effect/transition math (ABI pinned in each
  file's header: bindings, uniform layout, mode codes);
- `packages/shared/parity/*.json` + `packages/shared/golden/` — fixtures locking duplicated pure logic
  and rendered output.

Rules:

- **Native (Tauri) is the performance/architecture reference.** Web-only optimizations
  are legal only if they do not add mode codes, do not change uniform layouts, and do
  not require `src-tauri` changes. They must live in the TS pass builders, runners,
  caches and orchestration.
- Touching a shared `.wgsl` is justified only when **both** backends benefit and both
  are updated in the same change (plus parity/golden coverage).
- Web fallback paths (bitmap/readback, WebGL) are part of the architecture — keep them
  working; do not delete them to chase speed.

## Code and Architecture

- Prefer `interface` over `type` for objects.
- Functions with 3 or more arguments should accept a parameters object.
- Use named exports instead of default exports.
- Choose the most common, proven solutions for specific tasks.
- Do not change DB schemas, do not run migrations, and do not change the API without an explicit request.
- Do not write fallbacks of i18n srings in the code.

## Documentation and Tests

- Add detailed comments only to complex blocks; skip them for obvious lines.
- Place single-line comments strictly above the commented line.
- Always write unit or component tests for any new or modified functionality you introduce.
- When adding or changing functionality, update relevant tests and documentation (including `README.md`).

## Dependencies

- Use only official, well-maintained libraries.
- Rely on the latest stable versions and official documentation.
