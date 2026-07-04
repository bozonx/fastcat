# Tauri e2e (WebKitGTK, Linux)

Drives the **real** Tauri build (native WebKitGTK webview + real Rust backend)
via the official `tauri-driver` path — unlike the Playwright suite under
`test/e2e/`, which runs in Chromium with Tauri/fs mocked.

```
WebdriverIO  ->  tauri-driver  ->  WebKitWebDriver  ->  built FastCat binary
```

Use this layer only for things that genuinely need the native backend (IPC
contracts, real fs, native monitor/export). Keep product-logic coverage in the
faster Playwright suite.

## Scope

Tauri e2e is the smallest native confidence layer. Add tests here only when the
behavior can be wrong in the real Tauri/WebKitGTK app while still passing the
Chromium Playwright suite.

| Concern | Test here? | Better home |
| --- | --- | --- |
| App boots in the native webview and exposes Tauri internals | Yes | `test/tauri-e2e/specs/smoke.e2e.ts` |
| JS-to-Rust command wiring, payload shape, and command errors | Yes | Tauri e2e + matching unit/contract tests |
| Real filesystem permissions, app data paths, asset protocol URLs | Yes | Tauri e2e for the full path, unit tests for path helpers |
| Native file dialogs or OS-backed file picking flows | Yes, sparingly | Component/unit tests for dialog call wrappers |
| Native monitor/render/export pipeline through Rust | Yes, smoke-level | `test:golden` for frame parity, Rust tests for engine details |
| WebKitGTK-only regressions in app startup, CSP, workers, media, canvas | Yes, smoke-level | Playwright web e2e for product workflow depth |
| Timeline editing, selection, undo/redo, project workflow logic | No | `test/e2e/web` and unit tests |
| Pure math, serialization, media graph, transition logic | No | unit/parity/golden tiers |
| Browser-only OPFS workflows with mocked Tauri APIs | No | `test/e2e/web` |

Good Tauri e2e scenarios:

- Open the real app and verify it is running inside Tauri, not the web build.
- Create or open a workspace through the native backend and verify the resulting
  file exists at the OS path.
- Call a user flow that crosses the IPC boundary, then assert the Rust-side
  result or persisted file, not just a Vue store state.
- Start a short native export/monitor operation and assert completion plus one
  durable output signal.
- Verify an expected native failure path, such as denied/invalid filesystem
  scope, is surfaced to the UI.

Avoid:

- Repeating Playwright specs just because they are important.
- Long happy-path editor workflows; one native smoke per native subsystem is
  enough.
- Pixel-perfect rendering assertions. Use golden tests for rendered-frame
  comparisons.
- Tests that need arbitrary sleeps, real user home folders, or machine-specific
  media paths. Use temporary directories and deterministic fixtures.

## Authoring rules

- Keep specs under `test/tauri-e2e/specs/**/*.e2e.ts`.
- Use WebdriverIO globals from `@wdio/globals`.
- Prefer stable `data-testid` / semantic selectors over text that changes with
  i18n.
- Assert durable side effects when possible: an output file, IPC result, native
  error, document title, or Tauri runtime flag.
- Keep each spec independent. Native app state may survive between sessions more
  easily than browser storage, so create temporary paths per test.
- Do not use this tier as the first place to test product logic. Cover the logic
  in unit/Playwright first, then add a native smoke only for the Tauri boundary.

## Prerequisites (Linux only)

`tauri-driver` supports Linux and Windows; there is **no** macOS WebDriver.

- `WebKitWebDriver` on `PATH`
  - Arch/Manjaro: `webkitgtk-6.0` · Debian/Ubuntu: `webkit2gtk-driver`
- `tauri-driver`: `cargo install tauri-driver --locked`
  (config looks in `~/.cargo/bin`; override with `TAURI_DRIVER_PATH`)

## Run

```bash
# Build the release binary if missing, then run all specs
pnpm test:e2e:tauri

# Force a fresh release build first
pnpm test:e2e:tauri:build
```

The release build (`pnpm tauri build --no-bundle`) runs `pnpm generate` and
embeds the frontend into the binary, so the suite is self-contained.

### Fast local iteration

A debug binary points at the dev server (`devUrl :3009`) instead of an embedded
frontend, so to reuse one you must also run the dev server:

```bash
pnpm dev --port 3009 &
TAURI_E2E_BINARY=src-tauri/target/debug/fastcat pnpm exec wdio run test/tauri-e2e/wdio.conf.ts
```

## Env overrides

| Var                  | Default                      | Purpose                          |
| -------------------- | ---------------------------- | -------------------------------- |
| `TAURI_E2E_BINARY`   | `…/target/release/fastcat`   | Use a prebuilt binary as-is      |
| `TAURI_DRIVER_PATH`  | `~/.cargo/bin/tauri-driver`  | tauri-driver location            |
| `TAURI_DRIVER_PORT`  | `4444`                       | tauri-driver intermediary port   |
