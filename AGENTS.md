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

## Documentation and Tests
- Add detailed comments only to complex blocks; skip them for obvious lines.
- Place single-line comments strictly above the commented line.
- When adding or changing functionality, update relevant tests and documentation (including `README.md`).

## Dependencies
- Use only official, well-maintained libraries.
- Rely on the latest stable versions and official documentation.
- Always use Context7 for code generation, setup, or retrieving documentation for libraries/APIs.
