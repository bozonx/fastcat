import { open } from '@tauri-apps/plugin-fs';

/**
 * Process-wide pool of open *read* file handles, keyed by absolute path.
 *
 * `LazyTauriFile.arrayBuffer()` is called once per random-access range read.
 * mediabunny (and other random-readers) slice a single source file into many
 * small ranges, and each slice produces a fresh `LazyTauriFile` over the same
 * path. Opening + closing a native handle on every read is pure syscall
 * overhead on the hottest media path. This pool keeps a small set of handles
 * open per path and hands one out per read, closing them after a short idle
 * window so we neither thrash `open()`/`close()` nor pin file descriptors.
 *
 * Concurrency: a native handle carries a single seek cursor, so a borrowed
 * handle is held *exclusively* by one reader until returned. Overlapping reads
 * of the same path each get their own handle (an idle one, or a freshly opened
 * one). Callers therefore **must always seek before reading** — a pooled handle
 * inherits an arbitrary cursor position from its previous borrow.
 */

type TauriFileHandle = Awaited<ReturnType<typeof open>>;

/** Close idle handles for a path after this much inactivity. */
const IDLE_CLOSE_MS = 5_000;
/** Cap idle handles retained per path (overlapping reads beyond this just close on return). */
const MAX_IDLE_PER_PATH = 4;

const idleHandles = new Map<string, TauriFileHandle[]>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function borrow(path: string): Promise<TauriFileHandle> {
  const pool = idleHandles.get(path);
  const pooled = pool?.pop();
  if (pooled) {
    if (pool && pool.length === 0) idleHandles.delete(path);
    return pooled;
  }
  return open(path, { read: true });
}

function scheduleIdleClose(path: string): void {
  const existing = idleTimers.get(path);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    idleTimers.delete(path);
    const pool = idleHandles.get(path);
    idleHandles.delete(path);
    if (pool) {
      for (const handle of pool) void handle.close().catch(() => {});
    }
  }, IDLE_CLOSE_MS);
  // Don't keep a Node/Tauri event loop alive purely for the idle sweep.
  (timer as { unref?: () => void }).unref?.();
  idleTimers.set(path, timer);
}

function giveBack(path: string, handle: TauriFileHandle): void {
  const pool = idleHandles.get(path) ?? [];
  if (pool.length >= MAX_IDLE_PER_PATH) {
    void handle.close().catch(() => {});
    return;
  }
  pool.push(handle);
  idleHandles.set(path, pool);
  scheduleIdleClose(path);
}

/**
 * Borrow an open read handle for `path`, run `fn`, and return the handle to the
 * pool for reuse. A handle that errors mid-read is closed rather than recycled,
 * since its state is unknown.
 */
export async function withTauriReadHandle<T>(
  path: string,
  fn: (handle: TauriFileHandle) => Promise<T>,
): Promise<T> {
  const handle = await borrow(path);
  try {
    const result = await fn(handle);
    giveBack(path, handle);
    return result;
  } catch (error) {
    void handle.close().catch(() => {});
    throw error;
  }
}

/** Close and drop all pooled handles. Intended for tests and teardown. */
export async function resetTauriReadHandlePool(): Promise<void> {
  for (const timer of idleTimers.values()) clearTimeout(timer);
  idleTimers.clear();
  const handles = [...idleHandles.values()].flat();
  idleHandles.clear();
  await Promise.all(handles.map((handle) => handle.close().catch(() => {})));
}
