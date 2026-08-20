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
 */ import { createDevLogger } from '~/utils/dev-logger';

import { createLocalBudget, createSharedBudget, type IoBudget } from './io-budget';
import { isTauriRuntime } from '~/utils/runtime';
const log = createDevLogger('io-budget-worker');

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
  /**
   * True when this state was created by the grace-period fallback (no `io-init`
   * arrived in time) rather than a real init message. A genuine `io-init` that
   * arrives later is allowed to replace a fallback so a slow worker startup
   * doesn't permanently freeze us on a local, possibly-mis-capped budget.
   */
  isFallback?: boolean;
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
        log.warn('[io-budget] Worker io-init not received within 1s — using local budget');
        const fallbackIsTauri = isTauriRuntime();
        this.state = {
          budget: createLocalBudget({ isTauri: fallbackIsTauri, realm: 'worker' }),
          isTauri: fallbackIsTauri,
          isFallback: true,
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
    // A real init replaces a grace-period fallback, but never another real init
    // (the first authoritative init wins; later ones are ignored, e.g. on worker
    // reuse across host reloads).
    if (this.state && !this.state.isFallback) return;
    const isTauri = !!message.isTauri;
    if (message.sab && typeof Atomics !== 'undefined') {
      this.state = {
        budget: createSharedBudget(message.sab),
        isTauri,
      };
    } else {
      this.state = {
        budget: createLocalBudget({ isTauri, realm: 'worker' }),
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
