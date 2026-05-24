// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
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
    expect(budget.getSnapshot().interactiveAvailable).toBe(
      FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO,
    );
  });
});
