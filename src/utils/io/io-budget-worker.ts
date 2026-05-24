/**
 * Worker-side bootstrap for the shared I/O budget.
 *
 * Each worker listens for a single `io-init` message at the top of its message
 * pipeline and wires its `IoBudget` to the same `SharedArrayBuffer` the main
 * thread broadcasts. Before init completes, `getWorkerIoBudget()` returns a
 * promise that resolves once the buffer arrives — call sites simply `await` it.
 *
 * If `io-init` never arrives (for example when running in a unit-test harness
 * that mocks workers) we transparently fall back to an in-context local budget
 * so behaviour stays correct, just without cross-worker coordination.
 */

import { createLocalBudget, createSharedBudget, type IoBudget } from './io-budget';

interface IoInitMessage {
  type: 'io-init';
  sab: SharedArrayBuffer | null;
  isTauri: boolean;
}

function isIoInitMessage(value: unknown): value is IoInitMessage {
  if (!value || typeof value !== 'object') return false;
  return (value as { type?: unknown }).type === 'io-init';
}

interface WorkerBudgetState {
  budget: IoBudget;
  isTauri: boolean;
}

let state: WorkerBudgetState | null = null;
let readyResolve: ((value: WorkerBudgetState) => void) | null = null;
let readyPromise: Promise<WorkerBudgetState> = new Promise((resolve) => {
  readyResolve = resolve;
});

function applyInit(message: IoInitMessage): void {
  if (state) return;
  const isTauri = !!message.isTauri;
  if (message.sab && typeof Atomics !== 'undefined') {
    state = {
      budget: createSharedBudget(message.sab),
      isTauri,
    };
  } else {
    state = {
      budget: createLocalBudget({ isTauri }),
      isTauri,
    };
  }
  readyResolve?.(state);
  readyResolve = null;
}

/**
 * Register the io-init listener. Must run at worker module load (top-level
 * import order) so the listener exists before the main thread's first
 * postMessage arrives.
 *
 * Safe to call multiple times — only the first init message is applied. After
 * init, the handler quietly ignores subsequent `io-init` messages (e.g. when
 * a worker is reused across host reloads).
 */
export function installWorkerIoBudgetListener(): void {
  if (typeof self === 'undefined' || typeof self.addEventListener !== 'function') return;
  self.addEventListener('message', (event: MessageEvent) => {
    if (!isIoInitMessage(event.data)) return;
    applyInit(event.data);
  });
}

/**
 * Resolve the worker's {@link IoBudget}. Waits until the main thread's
 * `io-init` arrives. Falls back to a local budget after a short grace period
 * to keep tests from hanging when no init message will ever come.
 */
export function getWorkerIoBudget(): Promise<IoBudget> {
  if (state) return Promise.resolve(state.budget);
  const FALLBACK_MS = 1_000;
  const fallback = new Promise<WorkerBudgetState>((resolve) => {
    const handle = setTimeout(() => {
      if (state) {
        resolve(state);
        return;
      }
      console.warn('[io-budget] Worker io-init not received within 1s — using local budget');
      state = {
        budget: createLocalBudget({ isTauri: false }),
        isTauri: false,
      };
      readyResolve?.(state);
      readyResolve = null;
      resolve(state);
    }, FALLBACK_MS);
    // Allow timer to be GC'd if init arrives normally.
    if (typeof handle === 'object' && handle && 'unref' in handle) {
      (handle as { unref?: () => void }).unref?.();
    }
  });
  return Promise.race([readyPromise, fallback]).then((s) => s.budget);
}

/**
 * Synchronous accessor — returns the budget if already initialised, otherwise
 * `null`. Callers that hold a slot for a long-running write should await
 * {@link getWorkerIoBudget} once at startup and stash the result.
 */
export function tryGetWorkerIoBudget(): IoBudget | null {
  return state?.budget ?? null;
}

/**
 * Test-only helper to reset the singleton.
 */
export function __resetWorkerIoBudgetForTesting(): void {
  state = null;
  readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });
}
