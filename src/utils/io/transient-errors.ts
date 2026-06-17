/**
 * Shared classifier for transient I/O failures across main and worker threads.
 *
 * Chromium's OPFS implementation routes both `getFile()` reads and
 * `createWritable()` writes through a single renderer-process "datapipe" pool.
 * When the pool is exhausted (e.g. preview worker decoding video while UI
 * autosave runs), individual ops can fail mid-flight with `InvalidStateError:
 * Failed to create datapipe` or similar. A closely related failure happens when
 * a `FileSystemFileHandle`/`File` snapshot goes stale because the underlying
 * file changed on disk (e.g. an atomic temp-file `move()` replaced it during an
 * import): operations then throw `InvalidStateError: An operation that depends
 * on state cached in an interface object was made but the state had changed
 * since it was read from disk`. Both clear on their own — re-reading a fresh
 * handle / retrying with backoff succeeds — so callers should retry rather than
 * surface them as hard errors (or, worse, flag a perfectly good file as
 * corrupt).
 *
 * This module is the single source of truth for that classification. Both
 * `~/utils/io/io-governor.ts` (main thread) and `~/workers/core/io-governor.ts`
 * (worker threads) import from here to keep the heuristic in lockstep.
 */

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  cause?: unknown;
}

const TRANSIENT_NAMES = new Set(['InvalidStateError']);
const TRANSIENT_MESSAGE_PATTERN =
  /datapipe|failed to create|state had changed since it was read from disk|cached in an interface object/i;

/**
 * Whether an I/O failure looks like transient renderer-resource exhaustion or a
 * stale OPFS handle rather than a real I/O fault. Symmetric for reads
 * (`getFile()`) and writes (`createWritable()`).
 *
 * VFS adapters wrap raw `DOMException`s into typed `VfsError`s (so the original
 * `name` of `InvalidStateError` is lost on the outer error) but preserve the
 * platform error on `.cause`. We therefore walk the `cause` chain rather than
 * only inspecting the top-level error.
 */
export function isTransientIoError(error: unknown): boolean {
  let current: unknown = error;
  // Bounded walk down the `cause` chain to defend against cyclic causes.
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (typeof current !== 'object' && typeof current !== 'function') break;
    const candidate = current as ErrorLike;
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    if (name && TRANSIENT_NAMES.has(name)) return true;
    const message = typeof candidate.message === 'string' ? candidate.message : '';
    if (TRANSIENT_MESSAGE_PATTERN.test(message)) return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * Backwards-compatible alias retained for call sites that historically named
 * write-side retries explicitly. Behaviour is identical to {@link isTransientIoError}.
 */
export const isTransientWriteError = isTransientIoError;
