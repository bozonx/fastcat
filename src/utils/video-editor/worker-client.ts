import type {
  VideoCoreHostRpcMessage,
  VideoCoreWorkerAPI,
  VideoCoreWorkerRpcMessage,
  WorkerRpcErrorShape,
} from './worker-rpc';
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

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId?: number;
};

type WorkerMethod = keyof VideoCoreWorkerAPI;

interface WorkerChannelState {
  workerInstance: Worker | null;
  hostApiInstance: VideoCoreHostAPI | null;
  baseHostApi: VideoCoreHostAPI | null;
  taskHostApis: Map<string, WorkerTaskHostApi>;
  callIdCounter: number;
  pendingCalls: Map<number, PendingCall>;
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

function toError(error: WorkerRpcErrorShape | unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  const shape = error as WorkerRpcErrorShape | undefined;
  const message =
    typeof shape?.message === 'string' ? shape.message : String(error ?? 'Worker error');
  const nextError = new Error(message);

  if (typeof shape?.name === 'string') {
    nextError.name = shape.name;
  }
  if (typeof shape?.stack === 'string') {
    nextError.stack = shape.stack;
  }
  if (shape && 'cause' in shape) {
    Object.defineProperty(nextError, 'cause', {
      value: shape.cause,
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }

  return nextError;
}

async function callHostMethod(hostApi: VideoCoreHostAPI, message: VideoCoreHostRpcMessage) {
  if (message.type !== 'rpc-call') {
    return undefined;
  }

  switch (message.method) {
    case 'getCurrentProjectId':
      return await hostApi.getCurrentProjectId();
    case 'getFileHandleByPath':
      return await hostApi.getFileHandleByPath(
        ...(message.args as Parameters<VideoCoreHostAPI['getFileHandleByPath']>),
      );
    case 'getFileByPath':
      return (
        (await hostApi.getFileByPath?.(
          ...(message.args as Parameters<VideoCoreHostAPI['getFileByPath']>),
        )) ?? null
      );
    case 'ensureVectorImageRaster':
      return await hostApi.ensureVectorImageRaster(
        ...(message.args as Parameters<VideoCoreHostAPI['ensureVectorImageRaster']>),
      );
    case 'onExportProgress':
      return hostApi.onExportProgress(...(message.args as [number]), message.taskId);
    case 'onExportPhase':
      return hostApi.onExportPhase?.(...(message.args as ['encoding' | 'saving']), message.taskId);
    case 'onExportWarning':
      return hostApi.onExportWarning?.(...(message.args as [string]), message.taskId);
    default:
      throw new Error(`Method ${String(message.method)} not found on Host API`);
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

function createWorker(channel: WorkerChannel): Worker {
  const state = channelStates[channel];
  const worker = new Worker(new URL('../../workers/video-core.worker.ts', import.meta.url), {
    type: 'module',
    name: `video-core-${channel}`,
  });

  worker.addEventListener('message', async (e: MessageEvent<VideoCoreHostRpcMessage>) => {
    const data = e.data;
    if (!data || !data.type) return;

    if (data.type === 'rpc-response') {
      const pending = state.pendingCalls.get(data.id);
      if (pending) {
        if (pending.timeoutId !== undefined) window.clearTimeout(pending.timeoutId);
        if (data.error) {
          pending.reject(toError(data.error));
        } else pending.resolve(data.result);
        state.pendingCalls.delete(data.id);
      }
    } else if (data.type === 'rpc-call') {
      try {
        if (!state.hostApiInstance) throw new Error('Host API not set');
        const result = await callHostMethod(state.hostApiInstance, data);
        worker.postMessage({ type: 'rpc-response', id: data.id, method: data.method, result });
      } catch (err: unknown) {
        const error = toError(err);
        worker.postMessage({
          type: 'rpc-response',
          id: data.id,
          method: data.method,
          error: {
            name: error.name || 'Error',
            message: error.message,
            cause: 'cause' in error ? error.cause : undefined,
            stack: error.stack,
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
      err.name = 'WorkerQueueOverflowError';
      throw err;
    }
  }

  function postWorkerCall<K extends WorkerMethod>(
    method: K,
    args: Parameters<VideoCoreWorkerAPI[K]>,
    transferables?: Transferable[],
  ): Promise<Awaited<ReturnType<VideoCoreWorkerAPI[K]>>> {
    return new Promise((resolve, reject) => {
      try {
        ensurePendingSlot();
      } catch (err) {
        reject(err);
        return;
      }

      const id = (state.callIdCounter = (state.callIdCounter + 1) % Number.MAX_SAFE_INTEGER);

      let timeoutId: number | undefined;
      if (method !== 'exportTimeline' && method !== 'extractAudio') {
        timeoutId = window.setTimeout(() => {
          const pending = state.pendingCalls.get(id);
          if (pending) {
            state.pendingCalls.delete(id);
            pending.reject(new Error(`Worker RPC timeout for method: ${method}`));
          }
        }, 30000);
      }

      state.pendingCalls.set(id, { resolve, reject, timeoutId });

      const message = {
        type: 'rpc-call',
        id,
        method,
        args,
      } as VideoCoreWorkerRpcMessage;

      ensureWorker(channel).postMessage(message, transferables ?? []);
    });
  }

  const clientAPI = new Proxy(
    {},
    {
      get(_, method: WorkerMethod) {
        if (method === 'initCompositor') {
          return async (
            canvas: OffscreenCanvas,
            width: number,
            height: number,
            bgColor: string,
          ) => {
            return postWorkerCall('initCompositor', [canvas, width, height, bgColor], [canvas]);
          };
        }
        return async (...args: Parameters<VideoCoreWorkerAPI[typeof method]>) => {
          return postWorkerCall(method, args);
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
