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
