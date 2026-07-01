# AI Agents Guidelines

## Tech Stack
- **Framework**: Nuxt 4 (Vue 3, Composition API, `<script setup>`)
- **State Management**: Pinia
- **Styling**: Tailwind CSS (v4)
- **Language**: TypeScript
- **Testing**: Vitest (Unit), Playwright (E2E)
- **Linting & Formatting**: ESLint, Prettier

## Specific Project Structure (`src/`)
The project uses a custom `src/` directory. Besides the standard Nuxt folders (`components/`, `composables/`, `pages/`, `assets/`), there are specific ones:
- `src/stores/` — Pinia stores (application state, workspace, etc.).
- `src/utils/` — auxiliary pure functions, constants, configurations.
- `src/workers/` — Web Workers for heavy computations (e.g., video editor core).
- `src/timeline/` — logic and components specific to the video editor timeline.
- `src/locales/` — localization files (i18n).
- `src/utils/io/` — shared I/O budget and governor (`io-budget.ts`, `io-governor.ts`, `governed-blob.ts`). Main thread and workers coordinate OPFS access through a `SharedArrayBuffer` semaphore to avoid Chromium datapipe exhaustion.

## Testing Structure (`test/`)
Tests are organised into explicit **tiers** (one CI job each). Two things used to
both be called "parity" — keep them distinct:
- **parity** = pure cross-language _logic_ math (`shared/parity/*.json`, CPU) — lives in the unit/rust tiers, not a tier of its own.
- **golden** = cross-engine _rendered-frame_ comparison (`shared/golden/frames.json`, GPU) — its own tier, kept out of the merge gate.

| Tier | Directory | Command |
| --- | --- | --- |
| Unit | `test/unit/` (incl. `*.parity.test.ts`), `test/components/` | `pnpm test:unit` |
| Integration (web) | `test/integration/` (incl. `golden-registry/`), `test/golden-helpers/` | `pnpm test:integration:web` |
| Native (Rust) | `src-tauri/tests/`, Rust `#[test]`s (incl. logic parity) | `pnpm test:native` |
| E2E — smoke | `test/e2e/smoke/` | `pnpm test:e2e:smoke` |
| E2E — full | `test/e2e/web/` | `pnpm test:e2e` |
| Golden (rendered) | `test/golden/`, `src-tauri/tests/engine_parity.rs` | `pnpm test:golden` |

- `test:integration:native` is a curated fast **subset** of `test:native` (the latter runs the whole Rust suite incl. logic parity + golden, skipping GPU gracefully).
- `pnpm test` runs all Vitest tiers (unit + components + integration + golden-helpers) in one pass; `pnpm check` runs everything incl. e2e/golden; `pnpm check:fast` is the quick static + unit + web-integration loop.
- CI tiers are dispatched by `scripts/ci.sh <tier>` (blocking gate in `.github/workflows/ci.yml`; nightly non-blocking golden in `golden.yml`).
- `test/fixtures/` — Static assets and mock data for tests.
- `test/vitest.setup.ts` — Global configuration and mocks for Vitest.

## General Principles
- Communication with the user is conducted in Russian (including plans and reasoning).
- Code, commits, JSDoc, variable and function names must be in English (except i18n).
- Write minimalist, readable code. Follow DRY and SOLID principles.
- If you find minor issues in a working file (typos, formatting) — fix them. For serious ones (vulnerabilities) — report them, but do not fix without a command.

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

