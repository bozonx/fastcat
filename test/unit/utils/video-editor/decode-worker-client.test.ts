import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DecodeWorkerClient,
  DECODE_CANCELLED_MESSAGE,
} from '~/utils/video-editor/decode-worker-client';

// Minimal Worker stand-in: records posted messages and never auto-responds, so
// callers stay pending until the test drives a response or the client is
// destroyed. Mirrors the protocol the real audio-decode worker speaks.
class WorkerMock {
  public posted: unknown[] = [];
  private listeners: Record<string, Array<(event: unknown) => void>> = {};
  public terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message);
  }

  addEventListener(event: string, handler: (event: unknown) => void) {
    (this.listeners[event] ||= []).push(handler);
  }

  terminate() {
    this.terminated = true;
  }

  // Test helper: deliver a worker → main "decode-result" message.
  emitMessage(data: unknown) {
    for (const handler of this.listeners['message'] ?? []) {
      handler({ data });
    }
  }
}

let workerInstances: WorkerMock[] = [];

beforeEach(() => {
  workerInstances = [];
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        const mock = new WorkerMock();
        workerInstances.push(mock);
        return mock as unknown as Worker;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DecodeWorkerClient', () => {
  it('lazily creates a single worker shared across calls', () => {
    const client = new DecodeWorkerClient();
    void client.extractPeaks(new Blob(), 'a');
    void client.decodeRange(new Blob(), 'a', 0, 5);
    expect(workerInstances).toHaveLength(1);
  });

  it('resolves a pending call when the matching decode-result arrives', async () => {
    const client = new DecodeWorkerClient();
    const promise = client.extractPeaks(new Blob(), 'a');
    const worker = workerInstances[0]!;
    const req = worker.posted.at(-1) as { id: number };
    worker.emitMessage({ type: 'decode-result', id: req.id, ok: true, result: { peaks: [] } });
    await expect(promise).resolves.toEqual({ peaks: [] });
  });

  it('rejects with the worker error when ok is false', async () => {
    const client = new DecodeWorkerClient();
    const promise = client.decodeRange(new Blob(), 'a', 0, 5);
    const worker = workerInstances[0]!;
    const req = worker.posted.at(-1) as { id: number };
    worker.emitMessage({
      type: 'decode-result',
      id: req.id,
      ok: false,
      error: { message: 'boom', name: 'NotReadableError' },
    });
    await expect(promise).rejects.toMatchObject({ message: 'boom', name: 'NotReadableError' });
  });

  it('bounds concurrency to two simultaneous tasks', async () => {
    const client = new DecodeWorkerClient();
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];

    const make = () =>
      client.withSlot(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            release.push(() => {
              active -= 1;
              resolve();
            });
          }),
      );

    const tasks = [make(), make(), make(), make()];
    await Promise.resolve();
    await Promise.resolve();

    // Only two slots run at once; the rest wait.
    expect(active).toBe(2);

    // Drain: releasing running tasks lets queued ones start.
    while (release.length) {
      release.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it('rejects in-flight calls with the cancellation message on destroy', async () => {
    const client = new DecodeWorkerClient();
    const promise = client.extractPeaks(new Blob(), 'a');
    client.destroy();
    await expect(promise).rejects.toThrow(DECODE_CANCELLED_MESSAGE);
    expect(workerInstances[0]!.terminated).toBe(true);
  });

  it('rejects queued slot waiters on destroy', async () => {
    const client = new DecodeWorkerClient();
    const release: Array<() => void> = [];

    const first = client.withSlot(
      () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
    );
    const second = client.withSlot(
      () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
    );
    const queued = client.withSlot(async () => undefined);

    await Promise.resolve();
    expect(release).toHaveLength(2);

    client.destroy();

    await expect(queued).rejects.toThrow(DECODE_CANCELLED_MESSAGE);
    release.forEach((resolve) => resolve());
    await Promise.all([first, second]);
  });

  it('rejects immediately once destroyed without creating a worker', async () => {
    const client = new DecodeWorkerClient();
    client.destroy();
    await expect(client.extractPeaks(new Blob(), 'a')).rejects.toThrow(DECODE_CANCELLED_MESSAGE);
    await expect(client.decodeRange(new Blob(), 'a', 0, 5)).rejects.toThrow(
      DECODE_CANCELLED_MESSAGE,
    );
    expect(workerInstances).toHaveLength(0);
  });
});
