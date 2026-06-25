import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('~/utils/video-editor/worker-client');

vi.mock('~/utils/io/io-budget-main', () => ({
  postIoInitMessage: vi.fn(),
  isTauriRuntime: false,
}));

class ThrowingWorker {
  addEventListener() {}

  postMessage(): never {
    throw new DOMException('Clone failed', 'DataCloneError');
  }

  terminate() {}
}

class MockWorker {
  public posted: unknown[] = [];
  public terminated = false;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  postMessage(message: unknown, _transfer?: Transferable[]) {
    this.posted.push(message);
  }

  addEventListener(event: string, handler: (event: unknown) => void) {
    (this.listeners[event] ||= []).push(handler);
  }

  terminate() {
    this.terminated = true;
  }

  emit(event: string, data: unknown) {
    for (const handler of this.listeners[event] ?? []) {
      handler({ data });
    }
  }

  emitError(event: 'error' | 'messageerror') {
    for (const handler of this.listeners[event] ?? []) {
      handler(new Event(event));
    }
  }
}

function createHostApi(overrides?: Partial<{
  getCurrentProjectId: ReturnType<typeof vi.fn>;
  getFileHandleByPath: ReturnType<typeof vi.fn>;
  getFileByPath: ReturnType<typeof vi.fn>;
  ensureVectorImageRaster: ReturnType<typeof vi.fn>;
  onExportProgress: ReturnType<typeof vi.fn>;
  onExportPhase: ReturnType<typeof vi.fn>;
  onExportWarning: ReturnType<typeof vi.fn>;
}>) {
  return {
    getCurrentProjectId: overrides?.getCurrentProjectId ?? vi.fn().mockResolvedValue('proj-1'),
    getFileHandleByPath: overrides?.getFileHandleByPath ?? vi.fn().mockResolvedValue(null),
    getFileByPath: overrides?.getFileByPath ?? vi.fn().mockResolvedValue(null),
    ensureVectorImageRaster: overrides?.ensureVectorImageRaster ?? vi.fn().mockResolvedValue(null),
    onExportProgress: overrides?.onExportProgress ?? vi.fn(),
    onExportPhase: overrides?.onExportPhase ?? vi.fn(),
    onExportWarning: overrides?.onExportWarning ?? vi.fn(),
  };
}

describe('worker client', () => {
  let mockWorker: MockWorker;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockWorker = new MockWorker();
    // Worker must be a constructor function (arrow functions can't be used with new)
    vi.stubGlobal('Worker', function MockWorkerConstructor() {
      return mockWorker;
    });
  });

  afterEach(async () => {
    const {
      terminatePreviewWorker,
      terminateExportWorker,
      terminateProxyWorker,
      terminateThumbnailWorker,
    } = await import('~/utils/video-editor/worker-client');
    terminatePreviewWorker();
    terminateExportWorker();
    terminateProxyWorker();
    terminateThumbnailWorker();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('removes pending RPC calls when postMessage throws synchronously', async () => {
    vi.stubGlobal('Worker', ThrowingWorker);
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    for (let index = 0; index < 501; index += 1) {
      await expect(client.setPixiRendererPreference('webgl')).rejects.toMatchObject({
        name: 'DataCloneError',
      });
    }
  });

  it('resolves RPC call when worker sends a successful response', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const promise = client.setPixiRendererPreference('webgpu');

    const posted = mockWorker.posted[0] as { id: number; method: string };
    mockWorker.emit('message', { type: 'rpc-response', id: posted.id, result: undefined });

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects RPC call when worker sends an error response', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const promise = client.setPixiRendererPreference('webgl');

    const posted = mockWorker.posted[0] as { id: number };
    mockWorker.emit('message', {
      type: 'rpc-response',
      id: posted.id,
      error: { name: 'TypeError', message: 'bad arg' },
    });

    await expect(promise).rejects.toMatchObject({ name: 'TypeError', message: 'bad arg' });
  });

  it('rejects RPC call on timeout', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const promise = client.setPixiRendererPreference('webgl');
    // setPixiRendererPreference has a 10s timeout
    vi.advanceTimersByTime(10_001);

    await expect(promise).rejects.toThrow('Worker RPC timeout for method: setPixiRendererPreference');
  });

  it('does not timeout for methods with null timeout', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const promise = client.exportTimeline(null as any, {} as any, [], [], 'task-1');
    // exportTimeline has null timeout — advance far beyond default
    vi.advanceTimersByTime(120_000);

    // Should still be pending (not rejected)
    let rejected = false;
    promise.catch(() => {
      rejected = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toBe(false);
  });

  it('throws WorkerQueueOverflowError when pending calls exceed limit', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    // Fill up to the limit (500) — all pending since no response
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 500; i++) {
      promises.push(client.setPixiRendererPreference('webgl').catch(() => {}));
    }
    await vi.advanceTimersByTimeAsync(0);

    // The 501st call should overflow
    await expect(client.setPixiRendererPreference('webgl')).rejects.toMatchObject({
      name: 'WorkerQueueOverflowError',
    });
  });

  it('dispatches host RPC calls from worker and posts response', async () => {
    const { setPreviewHostApi, getPreviewWorkerClient } = await import(
      '~/utils/video-editor/worker-client'
    );
    const hostApi = createHostApi();
    setPreviewHostApi(hostApi);
    const { client } = getPreviewWorkerClient();

    // Trigger an RPC call to create the worker
    const rpcPromise = client.setPixiRendererPreference('webgl');
    const rpcId = (mockWorker.posted[0] as { id: number }).id;
    mockWorker.posted.length = 0;

    // Worker calls back to host
    mockWorker.emit('message', {
      type: 'rpc-call',
      id: 999,
      method: 'getCurrentProjectId',
      args: [],
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(hostApi.getCurrentProjectId).toHaveBeenCalled();

    const response = mockWorker.posted.find(
      (m) => (m as { type: string }).type === 'rpc-response' && (m as { id: number }).id === 999,
    );
    expect(response).toBeDefined();
    expect((response as { result: string }).result).toBe('proj-1');

    // Clean up the pending RPC
    mockWorker.emit('message', { type: 'rpc-response', id: rpcId, result: undefined });
    await rpcPromise;
  });

  it('routes onExportProgress to task-specific host API', async () => {
    const { setExportHostApi, registerExportTaskHostApi, getExportWorkerClient } = await import(
      '~/utils/video-editor/worker-client'
    );
    const baseProgress = vi.fn();
    const taskProgress = vi.fn();
    const hostApi = createHostApi({ onExportProgress: baseProgress });
    setExportHostApi(hostApi);
    registerExportTaskHostApi('task-42', { onExportProgress: taskProgress });
    const { client } = getExportWorkerClient();

    // Trigger worker creation
    client.setPixiRendererPreference('webgl').catch(() => {});

    // Worker calls onExportProgress with taskId
    mockWorker.emit('message', {
      type: 'rpc-call',
      id: 1,
      method: 'onExportProgress',
      args: [0.5],
      taskId: 'task-42',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(taskProgress).toHaveBeenCalledWith(0.5, 'task-42');
    expect(baseProgress).not.toHaveBeenCalled();
  });

  it('falls back to base host API when task API is not registered', async () => {
    const { setExportHostApi, getExportWorkerClient } = await import(
      '~/utils/video-editor/worker-client'
    );
    const baseProgress = vi.fn();
    const hostApi = createHostApi({ onExportProgress: baseProgress });
    setExportHostApi(hostApi);
    const { client } = getExportWorkerClient();

    client.setPixiRendererPreference('webgl').catch(() => {});

    mockWorker.emit('message', {
      type: 'rpc-call',
      id: 1,
      method: 'onExportProgress',
      args: [0.3],
      taskId: 'unknown-task',
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(baseProgress).toHaveBeenCalledWith(0.3, 'unknown-task');
  });

  it('throws when host API is not set and worker calls back', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    client.setPixiRendererPreference('webgl').catch(() => {});

    // Worker calls back without host API being set
    mockWorker.emit('message', {
      type: 'rpc-call',
      id: 1,
      method: 'getCurrentProjectId',
      args: [],
    });
    await vi.advanceTimersByTimeAsync(10);

    const response = mockWorker.posted.find(
      (m) => (m as { type: string; id: number }).type === 'rpc-response' && (m as { id: number }).id === 1,
    ) as { error?: { message: string } } | undefined;
    expect(response).toBeDefined();
    expect(response!.error?.message).toContain('Host API not set');
  });

  it('terminates worker and rejects all pending calls on worker error', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const promise = client.setPixiRendererPreference('webgl');
    await vi.advanceTimersByTimeAsync(0);

    mockWorker.emitError('error');

    await expect(promise).rejects.toThrow('Worker crashed');
    expect(mockWorker.terminated).toBe(true);
  });

  it('terminates worker and rejects all pending calls on messageerror', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const promise = client.setPixiRendererPreference('webgl');
    await vi.advanceTimersByTimeAsync(0);

    mockWorker.emitError('messageerror');

    await expect(promise).rejects.toThrow('Worker message channel failed');
    expect(mockWorker.terminated).toBe(true);
  });

  it('terminatePreviewWorker rejects all pending calls', async () => {
    const { getPreviewWorkerClient, terminatePreviewWorker } = await import(
      '~/utils/video-editor/worker-client'
    );
    const { client } = getPreviewWorkerClient();

    const promise = client.setPixiRendererPreference('webgl');
    await vi.advanceTimersByTimeAsync(0);

    terminatePreviewWorker('Custom reason');

    await expect(promise).rejects.toThrow('Custom reason');
    expect(mockWorker.terminated).toBe(true);
  });

  it('restartPreviewWorker creates a new worker', async () => {
    const { getPreviewWorkerClient, restartPreviewWorker } = await import(
      '~/utils/video-editor/worker-client'
    );
    const { client: _client1, worker: worker1 } = getPreviewWorkerClient();

    const newMockWorker = new MockWorker();
    vi.stubGlobal('Worker', function NewMockWorkerConstructor() {
      return newMockWorker;
    });

    const { worker: worker2 } = restartPreviewWorker();

    expect(worker1).not.toBe(worker2);
    expect(mockWorker.terminated).toBe(true);
  });

  it('initCompositor transfers canvas as transferable', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const canvas = new OffscreenCanvas(100, 100);
    const promise = client.initCompositor(canvas, 1920, 1080, '#000');

    await vi.advanceTimersByTimeAsync(0);

    // Verify the message was posted (transfer logic is in postMessage call)
    expect(mockWorker.posted.length).toBeGreaterThan(0);

    // Clean up
    const posted = mockWorker.posted[0] as { id: number };
    mockWorker.emit('message', { type: 'rpc-response', id: posted.id, result: undefined });
    await promise;
  });

  it('broadcastPixiRendererPreference sends to all active channels', async () => {
    const {
      setPreviewHostApi,
      setExportHostApi,
      setProxyHostApi,
      setThumbnailHostApi,
      getPreviewWorkerClient,
      getExportWorkerClient,
      getProxyWorkerClient,
      getThumbnailWorkerClient,
      broadcastPixiRendererPreference,
    } = await import('~/utils/video-editor/worker-client');

    const hostApi = createHostApi();
    setPreviewHostApi(hostApi);
    setExportHostApi(hostApi);
    setProxyHostApi(hostApi);
    setThumbnailHostApi(hostApi);

    // Create workers on all channels
    getPreviewWorkerClient();
    getExportWorkerClient();
    getProxyWorkerClient();
    getThumbnailWorkerClient();

    // Auto-respond to setPixiRendererPreference calls so the async loop proceeds
    const originalPostMessage = mockWorker.postMessage.bind(mockWorker);
    mockWorker.postMessage = (message: unknown) => {
      originalPostMessage(message);
      const msg = message as { method?: string; id?: number };
      if (msg.method === 'setPixiRendererPreference') {
        mockWorker.emit('message', { type: 'rpc-response', id: msg.id, result: undefined });
      }
    };

    const broadcastPromise = broadcastPixiRendererPreference('webgpu');
    await vi.advanceTimersByTimeAsync(1_000);

    // Each channel should have received a setPixiRendererPreference call
    const setPrefCalls = mockWorker.posted.filter(
      (m) =>
        (m as { method?: string }).method === 'setPixiRendererPreference',
    );
    expect(setPrefCalls.length).toBe(4);

    await broadcastPromise;
  });

  it('registerExportTaskHostApi with empty taskId is a no-op', async () => {
    const { registerExportTaskHostApi } = await import('~/utils/video-editor/worker-client');
    // Should not throw
    registerExportTaskHostApi('', { onExportProgress: vi.fn() });
  });

  it('unregisterExportTaskHostApi with empty taskId is a no-op', async () => {
    const { unregisterExportTaskHostApi } = await import('~/utils/video-editor/worker-client');
    // Should not throw
    unregisterExportTaskHostApi('');
  });

  it('getFileByPath returns null when not implemented', async () => {
    const { setPreviewHostApi, getPreviewWorkerClient } = await import(
      '~/utils/video-editor/worker-client'
    );
    const hostApi = createHostApi({ getFileByPath: undefined as any });
    setPreviewHostApi(hostApi);
    const { client } = getPreviewWorkerClient();

    client.setPixiRendererPreference('webgl').catch(() => {});

    mockWorker.emit('message', {
      type: 'rpc-call',
      id: 1,
      method: 'getFileByPath',
      args: ['/some/path'],
    });
    await vi.advanceTimersByTimeAsync(0);

    const response = mockWorker.posted.find(
      (m) => (m as { type: string; id: number }).type === 'rpc-response' && (m as { id: number }).id === 1,
    ) as { result?: unknown } | undefined;
    expect(response).toBeDefined();
    expect(response!.result).toBeNull();
  });

  it('throws for unknown host method', async () => {
    const { setPreviewHostApi, getPreviewWorkerClient } = await import(
      '~/utils/video-editor/worker-client'
    );
    const hostApi = createHostApi();
    setPreviewHostApi(hostApi);
    const { client } = getPreviewWorkerClient();

    client.setPixiRendererPreference('webgl').catch(() => {});

    mockWorker.emit('message', {
      type: 'rpc-call',
      id: 1,
      method: 'nonExistentMethod',
      args: [],
    });
    await vi.advanceTimersByTimeAsync(0);

    const response = mockWorker.posted.find(
      (m) => (m as { type: string; id: number }).type === 'rpc-response' && (m as { id: number }).id === 1,
    ) as { error?: { message: string } } | undefined;
    expect(response).toBeDefined();
    expect(response!.error?.message).toContain('nonExistentMethod');
  });

  it('ignores messages without type', async () => {
    const { getPreviewWorkerClient } = await import('~/utils/video-editor/worker-client');
    const { client } = getPreviewWorkerClient();

    const promise = client.setPixiRendererPreference('webgl');
    const rpcId = (mockWorker.posted[0] as { id: number }).id;
    await vi.advanceTimersByTimeAsync(0);
    mockWorker.posted.length = 0;

    // Send a message without type — should be ignored
    mockWorker.emit('message', { something: 'else' });
    await vi.advanceTimersByTimeAsync(0);

    // No response should have been posted
    expect(mockWorker.posted.length).toBe(0);

    // Clean up: resolve the original RPC
    mockWorker.emit('message', { type: 'rpc-response', id: rpcId, result: undefined });
    await promise;
  });

  it('backward-compatible aliases delegate to preview channel', async () => {
    const {
      setHostApi,
      getWorkerClient,
      terminateWorker,
      restartWorker,
    } = await import('~/utils/video-editor/worker-client');

    const hostApi = createHostApi();
    setHostApi(hostApi);
    const { client, worker: worker1 } = getWorkerClient();
    expect(client).toBeDefined();
    expect(worker1).toBeDefined();

    // restartWorker should return a new worker
    const newMock = new MockWorker();
    vi.stubGlobal('Worker', function RestartMockWorkerConstructor() {
      return newMock;
    });
    const { worker: worker2 } = restartWorker();
    expect(worker2).toBeDefined();
    expect(worker2).not.toBe(worker1);

    terminateWorker();
  });
});
