/**
 * Single source of truth for runtime-environment detection.
 *
 * Previously each call site inlined `'__TAURI_INTERNALS__' in window`, which
 * meant every test had to manipulate `window` directly and there was no single
 * point to stub the environment. Import {@link isTauriRuntime} instead.
 */

/**
 * Whether the app is running inside the Tauri desktop shell.
 *
 * Tauri injects the `__TAURI_INTERNALS__` global into the renderer's `window`.
 * We probe `window` first (matching the historical call sites and the real
 * injection target), then fall back to `globalThis` for worker/SSR contexts —
 * both correctly resolve to `false` when the global is absent.
 */
export function isTauriRuntime(): boolean {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return true;
  if (typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis) return true;
  return false;
}

/**
 * Whether the app is running on macOS.
 *
 * On macOS the primary command modifier is Cmd (Meta), not Ctrl. Hotkey
 * matching and display both consult this so that Cmd behaves like the stored
 * `Ctrl`-based bindings while physical Control stays inert (native Mac
 * behaviour). Prefers the modern `userAgentData.platform`, then falls back to
 * the deprecated `navigator.platform`, then the user-agent string. Computed
 * fresh (not memoised) so tests can stub `navigator` per-case.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;

  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) {
    return /mac/i.test(uaData.platform);
  }

  if (typeof navigator.platform === 'string' && navigator.platform) {
    return /mac/i.test(navigator.platform);
  }

  return typeof navigator.userAgent === 'string' && /mac/i.test(navigator.userAgent);
}
