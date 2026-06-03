import { getMainIoBudget, isTauriRuntime as isTauriRuntimeImpl } from './io-budget-main';
import { isTransientIoError, isTransientWriteError } from './transient-errors';
import { watchHeldSlot } from './slot-watchdog';
import { FILE_IO_LIMITS } from '~/utils/constants';

/**
 * Process-wide governor for file-system reads and writes on the main thread.
 *
 * The app has dozens of independent I/O sites — project/timeline autosaves,
 * audio peaks, metadata caches, thumbnails, proxies, plus the preview/export
 * workers — that all share Chromium's renderer-process datapipe pool. A burst
 * of `getFile()` + `createWritable()` calls used to exhaust the pool and
 * surface as `InvalidStateError: Failed to create datapipe`, freezing the
 * editor.
 *
 * This module is the main-thread facade over the shared
 * {@link `~/utils/io/io-budget`} semaphore. The semaphore is backed by a
 * `SharedArrayBuffer` and coordinates concurrency across every worker as well,
 * so the previous mismatch (main + each worker holding independent quotas) is
 * gone — there's now a single renderer-wide budget split into an *interactive*
 * pool (fast `getFile()` / small writes) and a *streaming* pool (long-lived
 * writables, large copies).
 *
 * New callers should wrap their `createWritable()` block in
 * {@link withFileIoSlot} (small writes) or acquire a streaming slot manually
 * via {@link acquireStreamingFileIoSlot} (long-lived writables) instead of
 * adding ad-hoc serialization.
 */

export { isTransientIoError, isTransientWriteError };

/** Re-export the runtime detector so existing call sites keep working. */
export const isTauriRuntime = isTauriRuntimeImpl;

let inFlightCount = 0;

/**
 * Run a short interactive I/O task under the shared budget. Use for
 * `getFile()` calls and small `createWritable()`+write+close sequences.
 */
export async function withFileIoSlot<T>(task: () => Promise<T>): Promise<T> {
  const release = watchHeldSlot(await getMainIoBudget().acquire('interactive'), {
    label: 'interactive',
    warnMs: FILE_IO_LIMITS.SLOT_HOLD_WARN_MS_INTERACTIVE,
    hardReleaseMs: FILE_IO_LIMITS.SLOT_HOLD_HARD_RELEASE_MS_INTERACTIVE,
  });
  inFlightCount += 1;
  try {
    return await task();
  } finally {
    inFlightCount -= 1;
    release();
  }
}

/**
 * Acquire a streaming slot manually for long-lived writables/copies. Caller
 * **must** invoke the returned release function in a `finally` block (or after
 * `close()`/`abort()`); otherwise the slot leaks and other writers stall.
 */
export async function acquireStreamingFileIoSlot(): Promise<() => void> {
  return watchHeldSlot(await getMainIoBudget().acquire('streaming'), {
    label: 'streaming',
    warnMs: FILE_IO_LIMITS.SLOT_HOLD_WARN_MS_STREAMING,
    hardReleaseMs: FILE_IO_LIMITS.SLOT_HOLD_HARD_RELEASE_MS_STREAMING,
  });
}

/**
 * Acquire a slot manually. Kept for compatibility with existing call sites
 * (e.g. tauri-handle.ts) — forwards to {@link acquireStreamingFileIoSlot}.
 * @deprecated Prefer {@link acquireStreamingFileIoSlot} explicitly.
 */
export async function acquireFileIoSlot(): Promise<() => void> {
  return acquireStreamingFileIoSlot();
}

/**
 * Run a write task under the interactive budget.
 * @deprecated Prefer {@link withFileIoSlot} for new callers; this alias is kept
 *   for existing write-only consumers and is identical in behaviour.
 */
export function withFileWriteSlot<T>(task: () => Promise<T>): Promise<T> {
  return withFileIoSlot(task);
}

/**
 * Inspect the current budget. Intended for diagnostics only — the real depth
 * lives in the shared atomic semaphore, so this only reports what is currently
 * known by the local snapshot.
 */
export function getFileWriteQueueStats(): {
  size: number;
  pending: number;
} {
  return {
    size: 0,
    pending: inFlightCount,
  };
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    if (typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function') {
      globalThis.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });

/**
 * Run a governed file write that retries transient datapipe exhaustion with
 * exponential backoff. Use this for writes whose loss matters (project config,
 * timeline document). `task` must be idempotent — it is re-run from scratch on
 * each attempt — which holds for the full-file overwrites used across the app.
 */
export async function runResilientFileWrite<T>(
  task: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, Math.round(options?.attempts ?? 4));
  const baseDelayMs = Math.max(1, Math.round(options?.baseDelayMs ?? 150));

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withFileIoSlot(task);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isTransientWriteError(error)) {
        throw error;
      }
      // Backoff between attempts; releasing the slot first lets the worker's
      // reads drain so the next attempt can grab a datapipe.
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/**
 * Run a governed read with the same retry semantics as
 * {@link runResilientFileWrite}. Symmetric with the worker-side variant.
 */
export async function runResilientFileIo<T>(
  task: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, Math.round(options?.attempts ?? 4));
  const baseDelayMs = Math.max(1, Math.round(options?.baseDelayMs ?? 150));

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withFileIoSlot(task);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isTransientIoError(error)) {
        throw error;
      }
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
