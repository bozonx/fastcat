// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkerIoBudget, type WorkerLike } from '~/utils/io/io-budget-worker';
import { FILE_IO_LIMITS } from '~/utils/constants';

function createMockWorker(): WorkerLike & { dispatch: (data: unknown) => void } {
  const listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  const worker: WorkerLike & { dispatch: (data: unknown) => void } = {
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatch(data: unknown) {
      const list = listeners.get('message') ?? [];
      for (const fn of list) {
        fn(new MessageEvent('message', { data }));
      }
    },
  };
  return worker;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('WorkerIoBudget', () => {
  let worker: ReturnType<typeof createMockWorker>;
  let budget: WorkerIoBudget;

  beforeEach(() => {
    worker = createMockWorker();
    budget = new WorkerIoBudget(worker);
  });

  it('resolves budget via io-init message', async () => {
    budget.installListener();
    const budgetPromise = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: false });

    const b = await budgetPromise;
    expect(b).toBeDefined();
    expect(b.isTauri()).toBe(false);
  });

  it('falls back to local budget after timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    budget.installListener();
    const budgetPromise = budget.getBudget();

    vi.advanceTimersByTime(1500);
    const b = await budgetPromise;
    expect(b).toBeDefined();
    vi.useRealTimers();
  });

  it('tryGetBudget returns null before init', () => {
    expect(budget.tryGetBudget()).toBeNull();
  });

  it('tryGetBudget returns budget after init', async () => {
    budget.installListener();
    const bPromise = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: false });
    await bPromise;

    expect(budget.tryGetBudget()).toBeDefined();
  });

  it('ignores non-io-init messages', async () => {
    budget.installListener();
    const budgetPromise = budget.getBudget();
    worker.dispatch({ type: 'other', sab: null, isTauri: false });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.advanceTimersByTime(1500);
    const b = await budgetPromise;
    expect(b).toBeDefined();
    vi.useRealTimers();
  });

  it('reset clears state and allows re-init', async () => {
    budget.installListener();
    const bPromise = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: false });
    await bPromise;

    budget.reset();
    expect(budget.tryGetBudget()).toBeNull();

    budget.installListener();
    const bPromise2 = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: true });
    const b2 = await bPromise2;
    expect(b2.isTauri()).toBe(true);
  });

  it('lets a real io-init replace a grace-period fallback', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    budget.installListener();
    const p = budget.getBudget();

    vi.advanceTimersByTime(1500);
    const fallback = await p;
    expect(fallback.isTauri()).toBe(false); // fallback assumes browser

    // A genuine io-init arrives late (slow worker startup) with isTauri=true.
    worker.dispatch({ type: 'io-init', sab: null, isTauri: true });
    vi.useRealTimers();

    const upgraded = await budget.getBudget();
    expect(upgraded.isTauri()).toBe(true);
    expect(upgraded).not.toBe(fallback);
  });

  it('ignores a second real io-init after the first authoritative one', async () => {
    budget.installListener();
    const p = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: true });
    const first = await p;
    expect(first.isTauri()).toBe(true);

    worker.dispatch({ type: 'io-init', sab: null, isTauri: false });
    const second = await budget.getBudget();
    expect(second).toBe(first); // unchanged
    expect(second.isTauri()).toBe(true);
  });

  it('acquire returns release function', async () => {
    budget.installListener();
    const bPromise = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: false });
    const b = await bPromise;

    const release = await b.acquire('interactive');
    expect(typeof release).toBe('function');
    release();
  });

  it('allows up to MAX_CONCURRENT_FILE_IO interactive slots', async () => {
    budget.installListener();
    const bPromise = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: false });
    const b = await bPromise;

    const releases: (() => void)[] = [];
    for (let i = 0; i < FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO; i += 1) {
      releases.push(await b.acquire('interactive'));
    }

    const extra = b.acquire('interactive');
    let extraResolved = false;
    extra.then(() => {
      extraResolved = true;
    });

    await flush();
    expect(extraResolved).toBe(false);

    releases[0]();
    await expect(extra).resolves.toBeTypeOf('function');
    (await extra)();

    releases.slice(1).forEach((r) => r());
  });

  it('installListener is idempotent', () => {
    budget.installListener();
    budget.installListener();
    // No error and listener still works
    const bPromise = budget.getBudget();
    worker.dispatch({ type: 'io-init', sab: null, isTauri: false });
    return expect(bPromise).resolves.toBeDefined();
  });
});

describe('default wrappers', () => {
  it('default exports exist and are functions', async () => {
    const {
      installWorkerIoBudgetListener,
      getWorkerIoBudget,
      tryGetWorkerIoBudget,
      __resetWorkerIoBudgetForTesting,
    } = await import('~/utils/io/io-budget-worker');
    expect(typeof installWorkerIoBudgetListener).toBe('function');
    expect(typeof getWorkerIoBudget).toBe('function');
    expect(typeof tryGetWorkerIoBudget).toBe('function');
    expect(typeof __resetWorkerIoBudgetForTesting).toBe('function');
  });
});
