/**
 * Shared classifier for transient I/O failures across main and worker threads.
 *
 * Chromium's OPFS implementation routes both `getFile()` reads and
 * `createWritable()` writes through a single renderer-process "datapipe" pool.
 * When the pool is exhausted (e.g. preview worker decoding video while UI
 * autosave runs), individual ops can fail mid-flight with `InvalidStateError:
 * Failed to create datapipe` or similar. These failures clear on their own once
 * the pool drains, so callers should retry with backoff rather than surface them
 * as hard errors.
 *
 * This module is the single source of truth for that classification. Both
 * `~/utils/io/io-governor.ts` (main thread) and `~/workers/core/io-governor.ts`
 * (worker threads) import from here to keep the heuristic in lockstep.
 */

interface ErrorLike {
  name?: unknown;
  message?: unknown;
}

const TRANSIENT_NAMES = new Set(['InvalidStateError']);
const TRANSIENT_MESSAGE_PATTERN = /datapipe|failed to create/i;

/**
 * Whether an I/O failure looks like transient renderer-resource exhaustion
 * rather than a real I/O fault. Symmetric for reads (`getFile()`) and writes
 * (`createWritable()`).
 */
export function isTransientIoError(error: unknown): boolean {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false;
  const candidate = error as ErrorLike;
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  if (name && TRANSIENT_NAMES.has(name)) return true;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return TRANSIENT_MESSAGE_PATTERN.test(message);
}

/**
 * Backwards-compatible alias retained for call sites that historically named
 * write-side retries explicitly. Behaviour is identical to {@link isTransientIoError}.
 */
export const isTransientWriteError = isTransientIoError;
