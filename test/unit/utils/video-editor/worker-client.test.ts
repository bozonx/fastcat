import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('~/utils/video-editor/worker-client');

class ThrowingWorker {
  addEventListener() {}

  postMessage(): never {
    throw new DOMException('Clone failed', 'DataCloneError');
  }

  terminate() {}
}

describe('worker client', () => {
  afterEach(async () => {
    const { terminatePreviewWorker } = await import('~/utils/video-editor/worker-client');
    terminatePreviewWorker();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('removes pending RPC calls when postMessage throws synchronously', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', ThrowingWorker);
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    for (let index = 0; index < 501; index += 1) {
      await expect(client.setPixiRendererPreference('webgl')).rejects.toMatchObject({
        name: 'DataCloneError',
      });
    }
  });
});
