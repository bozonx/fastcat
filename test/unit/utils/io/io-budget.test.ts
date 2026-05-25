// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import {
  canUseSharedBudget,
  createLocalBudget,
  createSharedBudget,
  createSharedBudgetBuffer,
} from '~/utils/io/io-budget';
import { FILE_IO_LIMITS } from '~/utils/constants';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('io-budget local budget', () => {
  it('allows up to MAX_CONCURRENT_FILE_IO interactive slots', async () => {
    const budget = createLocalBudget({ isTauri: false });

    const releases: (() => void)[] = [];
    for (let i = 0; i < FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO; i += 1) {
      releases.push(await budget.acquire('interactive'));
    }

    const extra = budget.acquire('interactive');
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

  it('allows up to MAX_CONCURRENT_FILE_IO_STREAMING streaming slots', async () => {
    const budget = createLocalBudget({ isTauri: false });

    const release = await budget.acquire('streaming');
    const extra = budget.acquire('streaming');
    let extraResolved = false;
    extra.then(() => {
      extraResolved = true;
    });

    await flush();
    expect(extraResolved).toBe(false);

    release();
    await expect(extra).resolves.toBeTypeOf('function');
    (await extra)();
  });

  it('does not over-subscribe when an acquire barges between release and woken waiter', async () => {
    const budget = createLocalBudget({ isTauri: false });
    const cap = FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO;

    const releases: (() => void)[] = [];
    const grant = (p: Promise<() => void>, onGrant: () => void) =>
      p.then((r) => {
        releases.push(r);
        onGrant();
      });

    // Fill all slots.
    for (let i = 0; i < cap; i += 1) releases.push(await budget.acquire('interactive'));

    let w1 = false;
    let w2 = false;
    let barge = false;
    grant(budget.acquire('interactive'), () => (w1 = true));
    grant(budget.acquire('interactive'), () => (w2 = true));
    await flush();
    expect(w1).toBe(false);

    // Free exactly one slot (wakes w1), then immediately fire a new acquire that
    // would barge ahead of the woken-but-not-yet-resumed waiter under the old code.
    releases.shift()!();
    grant(budget.acquire('interactive'), () => (barge = true));

    await flush();
    expect(w1).toBe(true); // the woken waiter got the freed slot
    expect(barge).toBe(false); // the barger did NOT steal it
    // The invariant the old code violated: available must never go negative.
    expect(budget.getSnapshot().interactiveAvailable).toBeGreaterThanOrEqual(0);

    // Drain everything; remaining waiters resolve only as slots free.
    let guard = 0;
    while ((!w2 || !barge) && guard < 50) {
      const r = releases.shift();
      if (r) r();
      // eslint-disable-next-line no-await-in-loop
      await flush();
      guard += 1;
    }
    expect(w2).toBe(true);
    expect(barge).toBe(true);
  });

  it('releases slots so queued tasks proceed', async () => {
    const budget = createLocalBudget({ isTauri: false });

    const releases: (() => void)[] = [];
    for (let i = 0; i < FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO; i += 1) {
      releases.push(await budget.acquire('interactive'));
    }

    const pNext = budget.acquire('interactive');
    let nextResolved = false;
    pNext.then(() => {
      nextResolved = true;
    });

    await flush();
    expect(nextResolved).toBe(false);

    releases[0]();
    await expect(pNext).resolves.toBeTypeOf('function');
    (await pNext)();

    releases.slice(1).forEach((r) => r());
  });
});

describe('canUseSharedBudget', () => {
  const g = globalThis as { crossOriginIsolated?: boolean };
  const sabAvailable = typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined';

  afterEach(() => {
    delete g.crossOriginIsolated;
  });

  it('is false when the realm is not cross-origin isolated', () => {
    g.crossOriginIsolated = false;
    expect(canUseSharedBudget()).toBe(false);
  });

  it('is false when crossOriginIsolated is unset', () => {
    delete g.crossOriginIsolated;
    expect(canUseSharedBudget()).toBe(false);
  });

  it('requires both SAB support and cross-origin isolation', () => {
    g.crossOriginIsolated = true;
    expect(canUseSharedBudget()).toBe(sabAvailable);
  });
});

describe('io-budget shared budget', () => {
  it('initialises with correct counts in the SAB', () => {
    const sab = createSharedBudgetBuffer({ isTauri: false });
    const budget = createSharedBudget(sab);
    const snapshot = budget.getSnapshot();
    expect(snapshot.interactiveAvailable).toBe(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO);
    expect(snapshot.streamingAvailable).toBe(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_STREAMING);
  });

  it('acquire decrements and release increments interactive slots', async () => {
    const sab = createSharedBudgetBuffer({ isTauri: false });
    const budget = createSharedBudget(sab);

    const release = await budget.acquire('interactive');
    expect(budget.getSnapshot().interactiveAvailable).toBe(
      FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO - 1,
    );

    release();
    expect(budget.getSnapshot().interactiveAvailable).toBe(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO);
  });
});
