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

export interface WorkerLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
}

export class WorkerIoBudget {
  private state: WorkerBudgetState | null = null;
  private readyResolve: ((value: WorkerBudgetState) => void) | null = null;
  private readyPromise: Promise<WorkerBudgetState>;
  private listenerInstalled = false;

  constructor(private readonly worker: WorkerLike | undefined) {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  installListener(): void {
    if (this.listenerInstalled) return;
    this.listenerInstalled = true;
    if (!this.worker) return;
    this.worker.addEventListener('message', (event: MessageEvent) => {
      if (!isIoInitMessage(event.data)) return;
      this.applyInit(event.data);
    });
  }

  getBudget(): Promise<IoBudget> {
    if (this.state) return Promise.resolve(this.state.budget);
    const FALLBACK_MS = 1_000;
    const fallback = new Promise<WorkerBudgetState>((resolve) => {
      const handle = setTimeout(() => {
        if (this.state) {
          resolve(this.state);
          return;
        }
        console.warn('[io-budget] Worker io-init not received within 1s — using local budget');
        this.state = {
          budget: createLocalBudget({ isTauri: false }),
          isTauri: false,
        };
        this.readyResolve?.(this.state);
        this.readyResolve = null;
        resolve(this.state);
      }, FALLBACK_MS);
      // Allow timer to be GC'd if init arrives normally.
      if (typeof handle === 'object' && handle && 'unref' in handle) {
        (handle as { unref?: () => void }).unref?.();
      }
    });
    return Promise.race([this.readyPromise, fallback]).then((s) => s.budget);
  }

  tryGetBudget(): IoBudget | null {
    return this.state?.budget ?? null;
  }

  reset(): void {
    this.state = null;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    this.listenerInstalled = false;
  }

  private applyInit(message: IoInitMessage): void {
    if (this.state) return;
    const isTauri = !!message.isTauri;
    if (message.sab && typeof Atomics !== 'undefined') {
      this.state = {
        budget: createSharedBudget(message.sab),
        isTauri,
      };
    } else {
      this.state = {
        budget: createLocalBudget({ isTauri }),
        isTauri,
      };
    }
    this.readyResolve?.(this.state);
    this.readyResolve = null;
  }
}

const defaultWorkerIoBudget = new WorkerIoBudget(
  typeof self !== 'undefined' ? (self as WorkerLike) : undefined,
);

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
  defaultWorkerIoBudget.installListener();
}

/**
 * Resolve the worker's {@link IoBudget}. Waits until the main thread's
 * `io-init` arrives. Falls back to a local budget after a short grace period
 * to keep tests from hanging when no init message will ever come.
 */
export function getWorkerIoBudget(): Promise<IoBudget> {
  return defaultWorkerIoBudget.getBudget();
}

/**
 * Synchronous accessor — returns the budget if already initialised, otherwise
 * `null`. Callers that hold a slot for a long-running write should await
 * {@link getWorkerIoBudget} once at startup and stash the result.
 */
export function tryGetWorkerIoBudget(): IoBudget | null {
  return defaultWorkerIoBudget.tryGetBudget();
}

/**
 * Test-only helper to reset the singleton.
 */
export function __resetWorkerIoBudgetForTesting(): void {
  defaultWorkerIoBudget.reset();
}
