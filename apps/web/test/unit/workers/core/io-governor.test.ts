/** @vitest-environment node */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  withWorkerFileIoSlot,
  withWorkerFileIoSlotForHandle,
  isTransientIoError,
  runResilientWorkerFileIo,
} from '~/workers/core/io-governor';
import { FILE_IO_LIMITS } from '~/utils/constants';

let originalFileSystemFileHandle: typeof FileSystemFileHandle | undefined;

beforeAll(() => {
  if (typeof FileSystemFileHandle === 'undefined') {
    class MockFileSystemFileHandle {}
    originalFileSystemFileHandle = undefined;
    (globalThis as any).FileSystemFileHandle = MockFileSystemFileHandle;
  }
});

afterAll(() => {
  if (originalFileSystemFileHandle === undefined) {
    delete (globalThis as any).FileSystemFileHandle;
  }
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('withWorkerFileIoSlot', () => {
  it('returns the task result', async () => {
    await expect(withWorkerFileIoSlot(async () => 42)).resolves.toBe(42);
  });

  it('never runs more than the local worker fallback cap concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    const expectedCap = FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_LOCAL_WORKER;

    const gates = Array.from({ length: 5 }, () => deferred());
    const tasks = gates.map((gate, index) =>
      withWorkerFileIoSlot(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
        return index;
      }),
    );

    try {
      await flush();
      expect(inFlight).toBe(expectedCap);
      expect(peak).toBe(expectedCap);
    } finally {
      gates.forEach((gate) => gate.resolve());
    }

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(expectedCap);
  });

  it('propagates task errors and keeps the queue usable afterwards', async () => {
    await expect(
      withWorkerFileIoSlot(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(withWorkerFileIoSlot(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('withWorkerFileIoSlotForHandle', () => {
  it('bypasses the queue for non-OPFS handles (Tauri serialised handles)', async () => {
    const tauriHandle = { createWritable: vi.fn() };
    const task = vi.fn().mockResolvedValue('done');

    const result = await withWorkerFileIoSlotForHandle(tauriHandle, task);

    expect(result).toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('bypasses the queue for plain objects', async () => {
    const plainHandle = {};
    const task = vi.fn().mockResolvedValue('done');

    const result = await withWorkerFileIoSlotForHandle(plainHandle, task);

    expect(result).toBe('done');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('routes through the queue for native FileSystemFileHandle', async () => {
    let inFlight = 0;

    const mockHandle = Object.create(FileSystemFileHandle.prototype);
    const task = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      await flush();
      inFlight -= 1;
      return 'queued';
    });

    const p1 = withWorkerFileIoSlotForHandle(mockHandle, task);
    const p2 = withWorkerFileIoSlotForHandle(mockHandle, task);

    await flush();
    expect(inFlight).toBeLessThanOrEqual(FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO_LOCAL_WORKER);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('queued');
    expect(r2).toBe('queued');
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('isTransientIoError', () => {
  it('flags InvalidStateError and messages containing datapipe/failed to create', () => {
    expect(
      isTransientIoError(Object.assign(new Error('Mojo error'), { name: 'InvalidStateError' })),
    ).toBe(true);
    expect(isTransientIoError(new Error('Failed to create datapipe'))).toBe(true);
    expect(isTransientIoError(new Error('Other datapipe error'))).toBe(true);
    expect(isTransientIoError(new Error('Something else'))).toBe(false);
  });

  it('flags the stale-handle InvalidStateError by message', () => {
    expect(
      isTransientIoError(
        new Error(
          'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.',
        ),
      ),
    ).toBe(true);
  });

  it('walks the cause chain when adapters wrap the platform error', () => {
    // VFS adapters rewrite the DOMException into a VfsIoError (losing the
    // `InvalidStateError` name on the outer error) but keep it on `.cause`.
    const platform = Object.assign(new Error('boom'), { name: 'InvalidStateError' });
    const wrapped = Object.assign(new Error('I/O error at _images/x.jpg'), {
      name: 'VfsIoError',
      cause: platform,
    });
    expect(isTransientIoError(wrapped)).toBe(true);
  });

  it('does not flag a genuine wrapped I/O fault', () => {
    const wrapped = Object.assign(new Error('I/O error at _images/x.jpg'), {
      name: 'VfsIoError',
      cause: new Error('disk full'),
    });
    expect(isTransientIoError(wrapped)).toBe(false);
  });
});

describe('runResilientWorkerFileIo', () => {
  it('retries transient failures and eventually succeeds', async () => {
    let calls = 0;
    const mockHandle = Object.create(FileSystemFileHandle.prototype);

    const result = await runResilientWorkerFileIo(
      mockHandle,
      async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error('Failed to create datapipe'), {
            name: 'InvalidStateError',
          });
        }
        return 'success';
      },
      { attempts: 4, baseDelayMs: 1 },
    );

    expect(result).toBe('success');
    expect(calls).toBe(3);
  });

  it('gives up after budget attempts', async () => {
    let calls = 0;
    const mockHandle = Object.create(FileSystemFileHandle.prototype);

    await expect(
      runResilientWorkerFileIo(
        mockHandle,
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

  it('does not retry non-transient errors', async () => {
    let calls = 0;
    const mockHandle = Object.create(FileSystemFileHandle.prototype);

    await expect(
      runResilientWorkerFileIo(
        mockHandle,
        async () => {
          calls += 1;
          throw new Error('Fatal filesystem error');
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('Fatal filesystem error');

    expect(calls).toBe(1);
  });
});
