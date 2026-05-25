/**
 * Cross-context I/O budget that coordinates main thread + workers.
 *
 * Chromium's OPFS implementation shares a single "datapipe" pool between every
 * `FileSystemFileHandle.getFile()` and `FileSystemWritableFileStream` open in
 * the renderer process. Up to now, the main thread had one PQueue-based
 * governor and each worker had another, and both consumed the same pool with
 * no shared budget. A burst of preview/export decoding could starve UI
 * autosaves (and vice versa), producing "Failed to create datapipe" errors
 * that surfaced as freezes.
 *
 * This module exposes a counting semaphore backed by a `SharedArrayBuffer`,
 * accessed from every context (main + every worker) via `Atomics`. The buffer
 * holds two pools — interactive (small, fast ops) and streaming (long-lived
 * writables, large copies) — sized once on init using `FILE_IO_LIMITS`.
 *
 * For environments where `SharedArrayBuffer` isn't available (Tauri renderer
 * without COOP/COEP, JSDOM in unit tests), we fall back to an in-context
 * `LocalBudget` that mirrors the same API but only governs that context.
 */

import { FILE_IO_LIMITS } from '~/utils/constants';

export type BudgetPool = 'interactive' | 'streaming';

export interface IoBudget {
  acquire(pool: BudgetPool): Promise<() => void>;
  getSnapshot(): { interactiveAvailable: number; streamingAvailable: number };
  isTauri(): boolean;
}

/**
 * Index layout for the shared `Int32Array` view. Five used slots, the rest is
 * reserved so we can add metrics without breaking the wire format.
 */
export const IO_BUDGET_SLOTS = {
  INTERACTIVE_AVAILABLE: 0,
  STREAMING_AVAILABLE: 1,
  INTERACTIVE_TOTAL: 2,
  STREAMING_TOTAL: 3,
  RUNTIME_FLAGS: 4,
} as const;

const RUNTIME_FLAG_TAURI = 1 << 0;

export const IO_BUDGET_BUFFER_BYTE_LENGTH = 8 * Int32Array.BYTES_PER_ELEMENT;

const WAIT_TIMEOUT_MS = 1_000;

function isSharedArrayBufferSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined';
}

/**
 * Whether the current realm is cross-origin isolated. This is the *real*
 * precondition for sharing a `SharedArrayBuffer` across threads: Chromium
 * exposes the `SharedArrayBuffer` constructor even without isolation (for
 * same-thread wasm), but `postMessage`-ing one to a worker throws
 * `DataCloneError` unless the page is cross-origin isolated.
 */
function isCrossOriginIsolated(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
  );
}

/**
 * Whether the shared (cross-thread) budget can actually be used. Requires both
 * the `SharedArrayBuffer`/`Atomics` API *and* cross-origin isolation — checking
 * only the former (as the previous code did) selected the shared path on
 * Chromium pages without COOP/COEP, where the SAB cannot be shared with workers
 * and the whole coordination silently breaks.
 */
export function canUseSharedBudget(): boolean {
  return isSharedArrayBufferSupported() && isCrossOriginIsolated();
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Resolve interactive/streaming concurrency from {@link FILE_IO_LIMITS}.
 */
export function resolveBudgetCapacity(isTauriRuntime: boolean): {
  interactive: number;
  streaming: number;
} {
  if (isTauriRuntime) {
    const native = Math.max(1, Math.round(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_NATIVE));
    return { interactive: native, streaming: native };
  }
  return {
    interactive: Math.max(1, Math.round(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO)),
    streaming: Math.max(1, Math.round(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_STREAMING)),
  };
}

function slotForPool(pool: BudgetPool): number {
  return pool === 'interactive'
    ? IO_BUDGET_SLOTS.INTERACTIVE_AVAILABLE
    : IO_BUDGET_SLOTS.STREAMING_AVAILABLE;
}

/**
 * Shared-memory budget implementation. Safe to call from any context as long
 * as every participant shares the same `SharedArrayBuffer`.
 */
class SharedBudget implements IoBudget {
  private readonly view: Int32Array;
  private readonly tauri: boolean;

  constructor(buffer: SharedArrayBuffer) {
    this.view = new Int32Array(buffer);
    const flags = Atomics.load(this.view, IO_BUDGET_SLOTS.RUNTIME_FLAGS);
    this.tauri = (flags & RUNTIME_FLAG_TAURI) !== 0;
  }

  isTauri(): boolean {
    return this.tauri;
  }

  getSnapshot() {
    return {
      interactiveAvailable: Atomics.load(this.view, IO_BUDGET_SLOTS.INTERACTIVE_AVAILABLE),
      streamingAvailable: Atomics.load(this.view, IO_BUDGET_SLOTS.STREAMING_AVAILABLE),
    };
  }

  async acquire(pool: BudgetPool): Promise<() => void> {
    const idx = slotForPool(pool);
    while (true) {
      if (this.tryAcquire(idx)) break;
      await this.waitForRelease(idx);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      Atomics.add(this.view, idx, 1);
      Atomics.notify(this.view, idx, 1);
    };
  }

  private tryAcquire(idx: number): boolean {
    while (true) {
      const current = Atomics.load(this.view, idx);
      if (current <= 0) return false;
      const swapped = Atomics.compareExchange(this.view, idx, current, current - 1);
      if (swapped === current) return true;
    }
  }

  private async waitForRelease(idx: number): Promise<void> {
    const current = Atomics.load(this.view, idx);
    if (current > 0) return;
    if (typeof Atomics.waitAsync !== 'function') {
      // Fallback: short async yield. waitAsync is supported in every modern
      // engine we target, so we should never hit this branch in production.
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return;
    }
    const result = Atomics.waitAsync(this.view, idx, 0, WAIT_TIMEOUT_MS);
    if (result.async) {
      await result.value;
    }
  }
}

interface LocalPoolState {
  available: number;
  waiters: Array<() => void>;
}

/**
 * Single-context fallback used when `SharedArrayBuffer` is unavailable. Has the
 * same surface as {@link SharedBudget} but only sequences operations within the
 * context that owns it — workers spawned without the shared buffer would have
 * their own independent fallback budgets.
 */
class LocalBudget implements IoBudget {
  private readonly tauri: boolean;
  private readonly pools: Record<BudgetPool, LocalPoolState>;

  constructor(input: { isTauri: boolean; interactive: number; streaming: number }) {
    this.tauri = input.isTauri;
    this.pools = {
      interactive: { available: input.interactive, waiters: [] },
      streaming: { available: input.streaming, waiters: [] },
    };
  }

  isTauri(): boolean {
    return this.tauri;
  }

  getSnapshot() {
    return {
      interactiveAvailable: this.pools.interactive.available,
      streamingAvailable: this.pools.streaming.available,
    };
  }

  async acquire(pool: BudgetPool): Promise<() => void> {
    const state = this.pools[pool];
    if (state.available > 0) {
      state.available -= 1;
      return this.makeRelease(state);
    }
    // No slot free: queue and wait. When we are woken the releaser has handed
    // its slot directly to us (it did NOT return it to `available`), so we must
    // NOT decrement again here.
    await new Promise<void>((resolve) => state.waiters.push(resolve));
    return this.makeRelease(state);
  }

  private makeRelease(state: LocalPoolState): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = state.waiters.shift();
      if (next) {
        // Hand the slot straight to the next waiter without bumping
        // `available`. Returning the slot to the pool first would let a
        // freshly-arriving `acquire()` grab it in the microtask gap before the
        // woken waiter resumes, over-subscribing the pool (and driving
        // `available` negative).
        next();
      } else {
        state.available += 1;
      }
    };
  }
}

/**
 * Allocate a freshly-initialised shared buffer. Only the main thread should
 * call this — workers receive the same buffer via `io-init` postMessage and
 * construct their `SharedBudget` against it.
 */
export function createSharedBudgetBuffer(input: { isTauri: boolean }): SharedArrayBuffer {
  if (!isSharedArrayBufferSupported()) {
    throw new Error('SharedArrayBuffer is not supported in this environment');
  }
  const buffer = new SharedArrayBuffer(IO_BUDGET_BUFFER_BYTE_LENGTH);
  const view = new Int32Array(buffer);
  const capacity = resolveBudgetCapacity(input.isTauri);
  Atomics.store(view, IO_BUDGET_SLOTS.INTERACTIVE_AVAILABLE, capacity.interactive);
  Atomics.store(view, IO_BUDGET_SLOTS.STREAMING_AVAILABLE, capacity.streaming);
  Atomics.store(view, IO_BUDGET_SLOTS.INTERACTIVE_TOTAL, capacity.interactive);
  Atomics.store(view, IO_BUDGET_SLOTS.STREAMING_TOTAL, capacity.streaming);
  Atomics.store(view, IO_BUDGET_SLOTS.RUNTIME_FLAGS, input.isTauri ? RUNTIME_FLAG_TAURI : 0);
  return buffer;
}

/**
 * Build a {@link IoBudget} from a previously initialised buffer. Throws if the
 * buffer is not a `SharedArrayBuffer` of the expected length.
 */
export function createSharedBudget(buffer: SharedArrayBuffer): IoBudget {
  if (buffer.byteLength < IO_BUDGET_BUFFER_BYTE_LENGTH) {
    throw new Error('Shared io-budget buffer is too small');
  }
  return new SharedBudget(buffer);
}

/**
 * Build a context-local fallback budget. Used when `SharedArrayBuffer` is
 * unavailable (e.g. JSDOM tests, environments without COOP/COEP).
 */
export function createLocalBudget(input: { isTauri: boolean }): IoBudget {
  const capacity = resolveBudgetCapacity(input.isTauri);
  return new LocalBudget({
    isTauri: input.isTauri,
    interactive: capacity.interactive,
    streaming: capacity.streaming,
  });
}

/**
 * Time spent acquiring an io-budget slot can be useful for diagnostics — caps
 * are intentionally tight on browser OPFS, so saturation manifests as latency.
 * Helper exposed for callers that want to log slow acquires.
 */
export async function timeAcquire(
  budget: IoBudget,
  pool: BudgetPool,
): Promise<{ release: () => void; waitMs: number }> {
  const startedAt = nowMs();
  const release = await budget.acquire(pool);
  return { release, waitMs: nowMs() - startedAt };
}
