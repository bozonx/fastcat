import type { VideoCoreWorkerAPI } from './worker-rpc';

export interface VideoCoreHostAPI {
  getFileHandleByPath(path: string): Promise<FileSystemFileHandle | null>;
  onExportProgress(progress: number): void;
  onExportPhase?(phase: 'encoding' | 'saving'): void;
}

type WorkerChannel = 'preview' | 'export';

interface WorkerChannelState {
  workerInstance: Worker | null;
  hostApiInstance: VideoCoreHostAPI | null;
  callIdCounter: number;
  pendingCalls: Map<number, { resolve: Function; reject: Function }>;
}

const channelStates: Record<WorkerChannel, WorkerChannelState> = {
  preview: {
    workerInstance: null,
    hostApiInstance: null,
    callIdCounter: 0,
    pendingCalls: new Map(),
  },
  export: {
    workerInstance: null,
    hostApiInstance: null,
    callIdCounter: 0,
    pendingCalls: new Map(),
  },
};

function rejectAllPendingCalls(state: WorkerChannelState, error: Error) {
  for (const [id, pending] of state.pendingCalls.entries()) {
    try {
      pending.reject(error);
    } finally {
      state.pendingCalls.delete(id);
    }
  }
}

function terminateChannel(channel: WorkerChannel, reason: string) {
  const state = channelStates[channel];
  if (state.workerInstance) {
    state.workerInstance.terminate();
    state.workerInstance = null;
  }
  rejectAllPendingCalls(state, new Error(reason));
}

function createWorker(channel: WorkerChannel): Worker {
  const state = channelStates[channel];
  const worker = new Worker(new URL('../../workers/video-core.worker.ts', import.meta.url), {
    type: 'module',
    name: `video-core-${channel}`,
  });

  worker.addEventListener('message', async (e) => {
    const data = e.data;
    if (!data || !data.type) return;

    if (data.type === 'rpc-response') {
      const pending = state.pendingCalls.get(data.id);
      if (pending) {
        if (data.error) {
          const errData = data.error;
          const message =
            typeof errData === 'string'
              ? errData
              : typeof errData?.message === 'string'
                ? errData.message
                : 'Worker error';

          const err = new Error(message);
          if (errData && typeof errData === 'object') {
            if (typeof (errData as any).name === 'string')
              (err as any).name = (errData as any).name;
            if (typeof (errData as any).stack === 'string')
              (err as any).stack = (errData as any).stack;
          }
          pending.reject(err);
        } else pending.resolve(data.result);
        state.pendingCalls.delete(data.id);
      }
    } else if (data.type === 'rpc-call') {
      try {
        if (!state.hostApiInstance) throw new Error('Host API not set');
        const method = data.method as keyof VideoCoreHostAPI;
        const fn = state.hostApiInstance[method];
        if (typeof fn !== 'function') {
          if (data.method === 'onExportPhase') {
            worker.postMessage({ type: 'rpc-response', id: data.id, result: undefined });
            return;
          }
          throw new Error(`Method ${data.method} not found on Host API`);
        }
        const result = await (fn as any)(...(data.args || []));
        worker.postMessage({ type: 'rpc-response', id: data.id, result });
      } catch (err: any) {
        worker.postMessage({
          type: 'rpc-response',
          id: data.id,
          error: {
            name: err?.name || 'Error',
            message: err?.message || String(err),
            stack: err?.stack,
          },
        });
      }
    }
  });

  worker.addEventListener('error', (event) => {
    console.error('[WorkerClient] Worker error', event);
    if (state.workerInstance === worker) {
      terminateChannel(channel, 'Worker crashed. Please retry the operation.');
    }
  });

  worker.addEventListener('messageerror', (event) => {
    console.error('[WorkerClient] Worker message error', event);
    if (state.workerInstance === worker) {
      terminateChannel(channel, 'Worker message channel failed. Please retry the operation.');
    }
  });

  return worker;
}

function ensureWorker(channel: WorkerChannel): Worker {
  const state = channelStates[channel];
  if (!state.workerInstance) {
    state.workerInstance = createWorker(channel);
  }
  return state.workerInstance;
}

function createChannelClient(channel: WorkerChannel): {
  client: VideoCoreWorkerAPI;
  worker: Worker;
} {
  const state = channelStates[channel];
  const worker = ensureWorker(channel);

  const clientAPI = new Proxy(
    {},
    {
      get(_, method: string) {
        if (method === 'initCompositor') {
          return async (
            canvas: OffscreenCanvas,
            width: number,
            height: number,
            bgColor: string,
          ) => {
            return new Promise<void>((resolve, reject) => {
              const id = ++state.callIdCounter;
              state.pendingCalls.set(id, { resolve, reject });
              ensureWorker(channel).postMessage(
                {
                  type: 'rpc-call',
                  id,
                  method: 'initCompositor',
                  args: [canvas, width, height, bgColor],
                },
                [canvas],
              );
            });
          };
        }
        return async (...args: any[]) => {
          return new Promise((resolve, reject) => {
            const id = ++state.callIdCounter;
            state.pendingCalls.set(id, { resolve, reject });
            ensureWorker(channel).postMessage({ type: 'rpc-call', id, method, args });
          });
        };
      },
    },
  ) as VideoCoreWorkerAPI;

  return {
    client: clientAPI,
    worker,
  };
}

export function setPreviewHostApi(api: VideoCoreHostAPI) {
  channelStates.preview.hostApiInstance = api;
}

export function setExportHostApi(api: VideoCoreHostAPI) {
  channelStates.export.hostApiInstance = api;
}

export function terminatePreviewWorker(reason = 'Preview worker terminated') {
  terminateChannel('preview', reason);
}

export function terminateExportWorker(reason = 'Export worker terminated') {
  terminateChannel('export', reason);
}

export function restartPreviewWorker() {
  terminateChannel('preview', 'Preview worker restarted');
  return getPreviewWorkerClient();
}

export function restartExportWorker() {
  terminateChannel('export', 'Export worker restarted');
  return getExportWorkerClient();
}

export function getPreviewWorkerClient(): { client: VideoCoreWorkerAPI; worker: Worker } {
  return createChannelClient('preview');
}

export function getExportWorkerClient(): { client: VideoCoreWorkerAPI; worker: Worker } {
  return createChannelClient('export');
}

// Backward-compatible aliases (preview channel)
export function setHostApi(api: VideoCoreHostAPI) {
  setPreviewHostApi(api);
}

export function terminateWorker(reason = 'Worker terminated') {
  terminatePreviewWorker(reason);
}

export function restartWorker() {
  return restartPreviewWorker();
}

export function getWorkerClient(): { client: VideoCoreWorkerAPI; worker: Worker } {
  return getPreviewWorkerClient();
}
