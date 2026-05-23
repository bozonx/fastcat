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
 */
const writeQueue = new PQueue({
  concurrency: Math.max(1, Math.round(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_WRITES)),
});

/**
 * Run a file-write task under the global write budget. The slot is held for the
 * full duration of `task`, so keep the whole `createWritable → write → close`
 * sequence inside it (that is what holds the datapipe open).
 */
export function withFileWriteSlot<T>(task: () => Promise<T>): Promise<T> {
  return writeQueue.add(task) as Promise<T>;
}

/** Inspect the write queue (depth + currently running). Intended for diagnostics. */
export function getFileWriteQueueStats(): { size: number; pending: number } {
  return { size: writeQueue.size, pending: writeQueue.pending };
}
