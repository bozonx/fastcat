// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  withFileWriteSlot,
  getFileWriteQueueStats,
  isTransientWriteError,
  runResilientFileWrite,
} from '~/utils/io/io-governor';
import { FILE_IO_LIMITS } from '~/utils/constants';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('io-governor withFileWriteSlot', () => {
  it('returns the task result', async () => {
    await expect(withFileWriteSlot(async () => 42)).resolves.toBe(42);
  });

  it('never runs more than MAX_CONCURRENT_FILE_IO tasks at once', async () => {
    const cap = FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO;
    let inFlight = 0;
    let peak = 0;

    const gates = Array.from({ length: cap + 3 }, () => deferred());
    const tasks = gates.map((gate, index) =>
      withFileWriteSlot(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
        return index;
      }),
    );

    // Let the queue schedule as many tasks as it is allowed to run concurrently.
    await flush();
    expect(inFlight).toBe(cap);
    expect(peak).toBe(cap);

    // Releasing slots must let queued tasks through, in order, without exceeding the cap.
    gates.forEach((gate) => gate.resolve());
    const results = await Promise.all(tasks);
    expect(results).toEqual(gates.map((_, index) => index));
    expect(peak).toBe(cap);
  });

  it('propagates task errors and keeps the queue usable afterwards', async () => {
    await expect(
      withFileWriteSlot(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(withFileWriteSlot(async () => 'ok')).resolves.toBe('ok');
    expect(getFileWriteQueueStats()).toEqual({ size: 0, pending: 0 });
  });
});

describe('io-governor isTransientWriteError', () => {
  it('flags datapipe / InvalidStateError exhaustion as transient', () => {
    expect(
      isTransientWriteError(
        Object.assign(new Error('Failed to create datapipe'), { name: 'InvalidStateError' }),
      ),
    ).toBe(true);
    expect(isTransientWriteError(new Error('write failed: datapipe'))).toBe(true);
    expect(isTransientWriteError({ name: 'InvalidStateError' })).toBe(true);
  });

  it('does not flag ordinary errors', () => {
    expect(isTransientWriteError(new Error('disk full'))).toBe(false);
    expect(isTransientWriteError(new Error('NotFoundError'))).toBe(false);
    expect(isTransientWriteError(null)).toBe(false);
  });
});

describe('io-governor runResilientFileWrite', () => {
  it('retries transient failures with backoff and eventually succeeds', async () => {
    let calls = 0;
    const result = await runResilientFileWrite(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error('Failed to create datapipe'), {
            name: 'InvalidStateError',
          });
        }
        return 'written';
      },
      { attempts: 4, baseDelayMs: 1 },
    );
    expect(result).toBe('written');
    expect(calls).toBe(3);
  });

  it('does not retry non-transient failures', async () => {
    let calls = 0;
    await expect(
      runResilientFileWrite(
        async () => {
          calls += 1;
          throw new Error('disk full');
        },
        { attempts: 4, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('disk full');
    expect(calls).toBe(1);
  });

  it('gives up after the attempt budget and rethrows the last transient error', async () => {
    let calls = 0;
    await expect(
      runResilientFileWrite(
        async () => {
          calls += 1;
          throw Object.assign(new Error('Failed to create datapipe'), {
            name: 'InvalidStateError',
          });
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('Failed to create datapipe');
    expect(calls).toBe(3);
  });
});
