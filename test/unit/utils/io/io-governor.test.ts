// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { withFileWriteSlot, getFileWriteQueueStats } from '~/utils/io/io-governor';
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

  it('never runs more than MAX_CONCURRENT_FILE_WRITES tasks at once', async () => {
    const cap = FILE_IO_LIMITS.MAX_CONCURRENT_FILE_WRITES;
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
