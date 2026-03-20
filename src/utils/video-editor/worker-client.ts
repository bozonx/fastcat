import type { VideoCoreWorkerAPI } from './worker-rpc';
import { VIDEO_CORE_LIMITS } from '../constants';

interface WorkerTaskHostApi {
  onExportProgress?: VideoCoreHostAPI['onExportProgress'];
  onExportPhase?: VideoCoreHostAPI['onExportPhase'];
  onExportWarning?: VideoCoreHostAPI['onExportWarning'];
}

export interface VideoCoreHostAPI {
  getCurrentProjectId(): Promise<string | null>;
  getFileHandleByPath(path: string): Promise<FileSystemFileHandle | null>;
  getFileByPath?(path: string): Promise<File | null>;
  ensureVectorImageRaster(params: {
    projectId: string;
    projectRelativePath: string;
    width: number;
    height: number;
    sourceFileHandle: FileSystemFileHandle;
  }): Promise<FileSystemFileHandle | null>;
  onExportProgress(progress: number, taskId?: string): void;
  onExportPhase?(phase: 'encoding' | 'saving', taskId?: string): void;
  onExportWarning?(message: string, taskId?: string): void;
}

type WorkerChannel = 'preview' | 'export' | 'proxy' | 'thumbnail';

interface WorkerChannelState {
  workerInstance: Worker | null;
  hostApiInstance: VideoCoreHostAPI | null;
  baseHostApi: VideoCoreHostAPI | null;
  taskHostApis: Map<string, WorkerTaskHostApi>;
  callIdCounter: number;
  pendingCalls: Map<number, { resolve: Function; reject: Function; timeoutId?: number }>;
}

const channelStates: Record<WorkerChannel, WorkerChannelState> = {
  preview: {
    workerInstance: null,
    hostApiInstance: null,
    baseHostApi: null,
    taskHostApis: new Map(),
    callIdCounter: 0,
    pendingCalls: new Map(),
  },
  export: {
    workerInstance: null,
    hostApiInstance: null,
    baseHostApi: null,
    taskHostApis: new Map(),
    callIdCounter: 0,
    pendingCalls: new Map(),
  },
  proxy: {
    workerInstance: null,
    hostApiInstance: null,
    baseHostApi: null,
    taskHostApis: new Map(),
    callIdCounter: 0,
    pendingCalls: new Map(),
  },
  thumbnail: {
    workerInstance: null,
    hostApiInstance: null,
    baseHostApi: null,
    taskHostApis: new Map(),
    callIdCounter: 0,
    pendingCalls: new Map(),
  },
};

function rejectAllPendingCalls(state: WorkerChannelState, error: Error) {
  for (const [id, pending] of state.pendingCalls.entries()) {
    try {
      if (pending.timeoutId !== undefined) window.clearTimeout(pending.timeoutId);
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
  state.taskHostApis.clear();
  rejectAllPendingCalls(state, new Error(reason));
}

function createRoutedHostApi(channel: WorkerChannel): VideoCoreHostAPI {
  const state = channelStates[channel];

  function getBaseHostApi() {
    const api = state.baseHostApi;
    if (!api) {
      throw new Error('Host API not set');
    }
    return api;
  }

  function getTaskHostApi(taskId?: string) {
    if (!taskId) return null;
    return state.taskHostApis.get(taskId) ?? null;
  }

  return {
    getCurrentProjectId: async () => await getBaseHostApi().getCurrentProjectId(),
    getFileHandleByPath: async (path) => await getBaseHostApi().getFileHandleByPath(path),
    getFileByPath: async (path) => {
      const result = await getBaseHostApi().getFileByPath?.(path);
      return result ?? null;
    },
    ensureVectorImageRaster: async (params) =>
      await getBaseHostApi().ensureVectorImageRaster(params),
    onExportProgress: (progress, taskId) => {
      const taskApi = getTaskHostApi(taskId);
      const handler = taskApi?.onExportProgress ?? state.baseHostApi?.onExportProgress;
      if (!handler) {
        throw new Error('Method onExportProgress not found on Host API');
      }
      return handler(progress, taskId);
    },
    onExportPhase: (phase, taskId) => {
      const taskApi = getTaskHostApi(taskId);
      return (
        taskApi?.onExportPhase?.(phase, taskId) ?? state.baseHostApi?.onExportPhase?.(phase, taskId)
      );
    },
    onExportWarning: (message, taskId) => {
      const taskApi = getTaskHostApi(taskId);
      return (
        taskApi?.onExportWarning?.(message, taskId) ??
        state.baseHostApi?.onExportWarning?.(message, taskId)
      );
    },
  };
}

import type { VideoCoreWorkerAPI, WorkerRpcMessage } from './worker-rpc';

// ... other imports ...

function createWorker(channel: WorkerChannel): Worker {
  const state = channelStates[channel];
  const worker = new Worker(new URL('../../workers/video-core.worker.ts', import.meta.url), {
    type: 'module',
    name: `video-core-${channel}`,
  });

  worker.addEventListener('message', async (e: MessageEvent<WorkerRpcMessage>) => {
    const data = e.data;
    if (!data || !data.type) return;

    if (data.type === 'rpc-response') {
      const pending = state.pendingCalls.get(data.id);
      if (pending) {
        if (pending.timeoutId !== undefined) window.clearTimeout(pending.timeoutId);
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
            if ((errData as any).cause !== undefined) (err as any).cause = (errData as any).cause;
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
          if (data.method === 'onExportPhase' || data.method === 'onExportWarning') {
            worker.postMessage({ type: 'rpc-response', id: data.id, result: undefined });
            return;
          }
          throw new Error(`Method ${data.method} not found on Host API`);
        }

        const args = data.args || [];
        if (
          data.taskId &&
          (method === 'onExportProgress' ||
            method === 'onExportPhase' ||
            method === 'onExportWarning')
        ) {
          // Detect if we need to append taskId as last argument or if it's already there
          // For now we assume taskId is passed in the message envelope
          const result = await (fn as any)(...args, data.taskId);
          worker.postMessage({ type: 'rpc-response', id: data.id, result });
        } else {
          const result = await (fn as any)(...args);
          worker.postMessage({ type: 'rpc-response', id: data.id, result });
        }
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

  function ensurePendingSlot() {
    const max = Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_WORKER_RPC_PENDING_CALLS));
    if (state.pendingCalls.size >= max) {
      const err = new Error('Worker RPC queue overflow');
      (err as any).name = 'WorkerQueueOverflowError';
      throw err;
    }
  }

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
              try {
                ensurePendingSlot();
              } catch (err) {
                reject(err);
                return;
              }
              const id = (state.callIdCounter =
                (state.callIdCounter + 1) % Number.MAX_SAFE_INTEGER);
              const timeoutId = window.setTimeout(() => {
                const p = state.pendingCalls.get(id);
                if (p) {
                  state.pendingCalls.delete(id);
                  p.reject(new Error(`Worker RPC timeout for method: initCompositor`));
                }
              }, 30000);
              state.pendingCalls.set(id, { resolve, reject, timeoutId });
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
            try {
              ensurePendingSlot();
            } catch (err) {
              reject(err);
              return;
            }
            const id = (state.callIdCounter = (state.callIdCounter + 1) % Number.MAX_SAFE_INTEGER);

            let timeoutId: number | undefined;
            // Do not apply timeout to long-running export/audio extraction methods
            if (method !== 'exportTimeline' && method !== 'extractAudio') {
              timeoutId = window.setTimeout(() => {
                const p = state.pendingCalls.get(id);
                if (p) {
                  state.pendingCalls.delete(id);
                  p.reject(new Error(`Worker RPC timeout for method: ${method}`));
                }
              }, 30000);
            }

            state.pendingCalls.set(id, { resolve, reject, timeoutId });
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
  channelStates.preview.baseHostApi = api;
  channelStates.preview.hostApiInstance = createRoutedHostApi('preview');
}

export function setExportHostApi(api: VideoCoreHostAPI) {
  channelStates.export.baseHostApi = api;
  channelStates.export.hostApiInstance = createRoutedHostApi('export');
}

export function setProxyHostApi(api: VideoCoreHostAPI) {
  channelStates.proxy.baseHostApi = api;
  channelStates.proxy.hostApiInstance = createRoutedHostApi('proxy');
}

export function setThumbnailHostApi(api: VideoCoreHostAPI) {
  channelStates.thumbnail.baseHostApi = api;
  channelStates.thumbnail.hostApiInstance = createRoutedHostApi('thumbnail');
}

export function registerExportTaskHostApi(taskId: string, api: WorkerTaskHostApi) {
  if (!taskId) return;
  channelStates.export.taskHostApis.set(taskId, api);
}

export function unregisterExportTaskHostApi(taskId: string) {
  if (!taskId) return;
  channelStates.export.taskHostApis.delete(taskId);
}

export function terminatePreviewWorker(reason = 'Preview worker terminated') {
  terminateChannel('preview', reason);
}

export function terminateExportWorker(reason = 'Export worker terminated') {
  terminateChannel('export', reason);
}

export function terminateProxyWorker(reason = 'Proxy worker terminated') {
  terminateChannel('proxy', reason);
}

export function restartPreviewWorker() {
  terminateChannel('preview', 'Preview worker restarted');
  return getPreviewWorkerClient();
}

export function restartExportWorker() {
  terminateChannel('export', 'Export worker restarted');
  return getExportWorkerClient();
}

export function restartProxyWorker() {
  terminateChannel('proxy', 'Proxy worker restarted');
  return getProxyWorkerClient();
}

export function terminateThumbnailWorker(reason = 'Thumbnail worker terminated') {
  terminateChannel('thumbnail', reason);
}

export function restartThumbnailWorker() {
  terminateChannel('thumbnail', 'Thumbnail worker restarted');
  return getThumbnailWorkerClient();
}

export function getPreviewWorkerClient(): { client: VideoCoreWorkerAPI; worker: Worker } {
  return createChannelClient('preview');
}

export function getExportWorkerClient(): { client: VideoCoreWorkerAPI; worker: Worker } {
  return createChannelClient('export');
}

export function getProxyWorkerClient(): { client: VideoCoreWorkerAPI; worker: Worker } {
  return createChannelClient('proxy');
}

export function getThumbnailWorkerClient(): { client: VideoCoreWorkerAPI; worker: Worker } {
  return createChannelClient('thumbnail');
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
