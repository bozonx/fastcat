/**
 * Main-thread bootstrap for the shared I/O budget.
 *
 * The renderer-process datapipe pool is shared between the main thread and
 * every worker; this module creates one `SharedArrayBuffer` per session, hands
 * it to all workers as they start, and exposes a singleton `IoBudget` for the
 * main thread to use through `~/utils/io/io-governor.ts`.
 *
 * Workers receive the buffer via `postIoInitMessage(worker, ...)` immediately
 * after construction. They install a listener in their own io-budget bootstrap
 * before any other message arrives.
 */

import {
  createLocalBudget,
  createSharedBudget,
  createSharedBudgetBuffer,
  type IoBudget,
} from './io-budget';
import { isTauriRuntime } from '~/utils/runtime';

/**
 * Re-export the canonical Tauri detector (see `~/utils/runtime`) so the legacy
 * main-thread governor (`io-governor.ts`) keeps importing it from here.
 */
export { isTauriRuntime };

interface MainBudgetState {
  budget: IoBudget;
  buffer: SharedArrayBuffer | null;
  isTauri: boolean;
}

let state: MainBudgetState | null = null;

function initState(): MainBudgetState {
  const tauri = isTauriRuntime();
  if (typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined') {
    try {
      const buffer = createSharedBudgetBuffer({ isTauri: tauri });
      return {
        buffer,
        budget: createSharedBudget(buffer),
        isTauri: tauri,
      };
    } catch (err) {
      console.warn('[io-budget] Falling back to local budget — SAB init failed:', err);
    }
  }
  return {
    buffer: null,
    budget: createLocalBudget({ isTauri: tauri }),
    isTauri: tauri,
  };
}

function ensureState(): MainBudgetState {
  if (!state) state = initState();
  return state;
}

/**
 * Return the shared {@link IoBudget} for the main thread. Lazily initialises on
 * first use; safe to call from module top-level imports.
 */
export function getMainIoBudget(): IoBudget {
  return ensureState().budget;
}

/**
 * Post an `io-init` message to a newly created worker so its budget is wired up
 * to the same shared pool. No-op when running with the local fallback.
 *
 * Must be called before any other postMessage to the worker, because worker's
 * io-budget listener is registered synchronously at module load and the first
 * `io-init` it sees wins.
 */
export function postIoInitMessage(worker: Worker): void {
  const current = ensureState();
  worker.postMessage({
    type: 'io-init',
    sab: current.buffer,
    isTauri: current.isTauri,
  });
}

/**
 * Test-only helper to forcibly reset the budget singleton (e.g. so each Vitest
 * spec gets a fresh local budget). Intentionally not part of the documented
 * runtime surface.
 */
export function __resetMainIoBudgetForTesting(): void {
  state = null;
}
