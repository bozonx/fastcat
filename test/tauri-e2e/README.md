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
