import PQueue from 'p-queue';

import { FILE_IO_LIMITS } from '~/utils/constants';

/**
 * Process-wide governor for file-system writes.
 *
 * The app has dozens of independent writers — project settings/ui/meta autosave,
 * timeline autosave + backups, audio peaks, metadata caches, thumbnails,
 * proxies — that each called `createWritable()` with no shared budget. Every
 * open `FileSystemWritableFileStream` consumes a Chromium "datapipe" handle, and
 * the preview/export workers read video through the *same* renderer-process
 * pool. A burst of edits (e.g. dragging a shadow slider while autosave runs)
 * could therefore exhaust the pool, surfacing as
 * `InvalidStateError: Failed to create datapipe` on the write side and
 * `TypeError: network error` on the worker read side, freezing the editor.
 *
 * Routing every write through one bounded queue caps how many writables can be
 * open at once and turns bursts into backpressure (callers queue) instead of
 * hard failures. This is the single chokepoint; new writers should wrap their
 * `createWritable()` block in {@link withFileWriteSlot} rather than adding their
 * own ad-hoc serialization.
 *
 * The cap is runtime-dependent: the datapipe pool is a browser (Chromium FSA /
 * OPFS) constraint. In Tauri, writes go to the native filesystem and do not
 * share that pool, so a much higher cap is used to avoid throttling desktop I/O.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function resolveInteractiveConcurrency(): number {
  const limit = isTauriRuntime()
    ? FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_NATIVE
    : FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO;
  return Math.max(1, Math.round(limit));
}

function resolveStreamingConcurrency(): number {
  const limit = isTauriRuntime()
    ? FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_NATIVE
    : FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_STREAMING;
  return Math.max(1, Math.round(limit));
}

/**
 * Queue for fast/interactive file operations (e.g. metadata queries, configuration loading,
 * small writes, getFile calls).
 */
const interactiveQueue = new PQueue({ concurrency: resolveInteractiveConcurrency() });

/**
 * Queue for long-running streaming file operations (e.g. video file imports, VFS copies).
 * Separating this ensures imports never block interactive timeline loading or UI autosave.
 */
const streamingQueue = new PQueue({ concurrency: resolveStreamingConcurrency() });

export function withFileIoSlot<T>(task: () => Promise<T>): Promise<T> {
  return interactiveQueue.add(task) as Promise<T>;
}

/**
 * Acquire a file I/O slot manually for streaming operations. Returns a release function
 * that must be called when the slot is no longer needed (after stream close/abort).
 */
export async function acquireStreamingFileIoSlot(): Promise<() => void> {
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  void streamingQueue.add(async () => {
    start();
    await hold;
  });
  await started;
  return release;
}

/**
 * Acquire a file I/O slot manually. Legacy method, now forwards to acquireStreamingFileIoSlot.
 * @deprecated Prefer {@link acquireStreamingFileIoSlot} for streaming writes.
 */
export async function acquireFileIoSlot(): Promise<() => void> {
  return acquireStreamingFileIoSlot();
}

/**
 * Run a file-write task under the global write budget.
 * @deprecated Prefer {@link withFileIoSlot} for new callers; this alias is kept
 *   for existing write-only consumers and now routes through the interactive queue.
 */
export function withFileWriteSlot<T>(task: () => Promise<T>): Promise<T> {
  return interactiveQueue.add(task) as Promise<T>;
}

/** Inspect the write queues (depth + currently running). Intended for diagnostics. */
export function getFileWriteQueueStats(): { size: number; pending: number } {
  return {
    size: interactiveQueue.size + streamingQueue.size,
    pending: interactiveQueue.pending + streamingQueue.pending,
  };
}

/**
 * Whether a write failure looks like transient renderer resource exhaustion
 * rather than a real I/O fault. The governor caps writes on the main thread, but
 * it cannot see the preview/export worker's video reads draining the *same*
 * datapipe pool, so a write can still occasionally fail with
 * `InvalidStateError: Failed to create datapipe`. Such failures clear on their
 * own once the pool drains, so they are worth retrying.
 */
export function isTransientWriteError(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return name === 'InvalidStateError' || /datapipe|failed to create/i.test(message);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      setTimeout(resolve, ms);
    } else {
      window.setTimeout(resolve, ms);
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
      return await withFileWriteSlot(task);
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
