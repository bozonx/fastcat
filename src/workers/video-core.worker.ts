import './worker-polyfill';
import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

import type { VideoCoreHostAPI } from '../utils/video-editor/worker-client';
import { VideoCompositor } from '../utils/video-editor/VideoCompositor';
import { parseMediaMetadata, PreviewRenderOptionsSchema } from '../utils/video-editor/worker-rpc';
import type {
  PreviewRenderOptions,
  VideoCoreHostRpcMessage,
  VideoCoreWorkerAPI,
  VideoCoreWorkerRpcMessage,
  WorkerRpcErrorShape,
} from '../utils/video-editor/worker-rpc';
import type { MediaMetadata } from '../stores/media.store';
import { ExportOptionsSchema } from '../composables/timeline/export/types';
import { initEffects } from '../effects';
import { initTransitions } from '../transitions';
import { normalizeRpcError } from './core/utils';
import { extractMetadata, runExport, extractAudioStream } from './core/export';
import { runTranscode } from './core/transcode';
import { VIDEO_CORE_LIMITS } from '../utils/constants';

DOMAdapter.set(WebWorkerAdapter);
initEffects();
initTransitions();

let hostClient: VideoCoreHostAPI | null = null;
let compositor: VideoCompositor | null = null;
let cancelExportRequested = false;
let latestLoadTimelineRequestId = 0;
let pixiRendererPreference: 'webgl' | 'webgpu' = 'webgl';

let renderInFlight = false;
let latestRenderTimeUs: number | null = null;
let latestPreviewOptions: PreviewRenderOptions | undefined;

type WorkerPendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId?: number;
};

type WorkerMethod = keyof VideoCoreWorkerAPI;

function serializeWorkerError(err: unknown): WorkerRpcErrorShape {
  if (err instanceof Error) {
    return {
      name: err.name || 'Error',
      message: err.message,
      cause: 'cause' in err ? err.cause : undefined,
      stack: err.stack,
    };
  }

  return {
    name: 'Error',
    message: String(err),
  };
}

async function callWorkerMethod<K extends WorkerMethod>(
  method: K,
  args: Parameters<VideoCoreWorkerAPI[K]>,
): Promise<Awaited<ReturnType<VideoCoreWorkerAPI[K]>>> {
  switch (method) {
    case 'extractMetadata':
      return parseMediaMetadata(await extractMetadata(args[0] as File)) as Awaited<
        ReturnType<VideoCoreWorkerAPI[K]>
      >;
    case 'renderFrame': {
      const [timeUs, options] = args as Parameters<VideoCoreWorkerAPI['renderFrame']>;
      const parsedOptions = options ? PreviewRenderOptionsSchema.parse(options) : undefined;
      return api.renderFrame(timeUs, parsedOptions) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    }
    case 'initCompositor':
      return api.initCompositor(
        ...(args as Parameters<VideoCoreWorkerAPI['initCompositor']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'loadTimeline':
      return api.loadTimeline(
        ...(args as Parameters<VideoCoreWorkerAPI['loadTimeline']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'updateTimelineLayout':
      return api.updateTimelineLayout(
        ...(args as Parameters<VideoCoreWorkerAPI['updateTimelineLayout']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'clearClips':
      return api.clearClips() as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'destroyCompositor':
      return api.destroyCompositor() as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'exportTimeline':
      return api.exportTimeline(
        ...(args as Parameters<VideoCoreWorkerAPI['exportTimeline']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'transcodeMedia':
      return api.transcodeMedia(
        ...(args as Parameters<VideoCoreWorkerAPI['transcodeMedia']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'cancelExport':
      return api.cancelExport(
        ...(args as Parameters<VideoCoreWorkerAPI['cancelExport']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'extractFrameToBlob':
      return api.extractFrameToBlob(
        ...(args as Parameters<VideoCoreWorkerAPI['extractFrameToBlob']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'extractAudio':
      return api.extractAudio(
        ...(args as Parameters<VideoCoreWorkerAPI['extractAudio']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'extractVideoFrameBlobs':
      return api.extractVideoFrameBlobs(
        ...(args as Parameters<VideoCoreWorkerAPI['extractVideoFrameBlobs']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    case 'releaseFrameExtractor':
      return api.releaseFrameExtractor(
        ...(args as Parameters<VideoCoreWorkerAPI['releaseFrameExtractor']>),
      ) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
    default:
      throw new Error(`Unsupported worker method: ${String(method)}`);
  }
}

function createHostRpcCall(method: keyof VideoCoreHostAPI, args: unknown[]) {
  let taskId: string | undefined;
  let messageArgs = args;

  if (
    (method === 'onExportProgress' || method === 'onExportPhase' || method === 'onExportWarning') &&
    args.length >= 2 &&
    typeof args[args.length - 1] === 'string'
  ) {
    taskId = args[args.length - 1] as string;
    messageArgs = args.slice(0, -1);
  }

  return {
    taskId,
    message: {
      type: 'rpc-call',
      id: 0,
      method,
      args: messageArgs,
      taskId,
    } as VideoCoreHostRpcMessage,
  };
}

async function reportExportWarning(message: string, taskId?: string) {
  console.warn(message, taskId ? `[task:${taskId}]` : '');
  if (!hostClient) return;
  try {
    await hostClient.onExportWarning?.(message, taskId);
  } catch {
    // ignore
  }
}

const api: Omit<VideoCoreWorkerAPI, 'initCompositor'> & {
  initCompositor(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    bgColor: string,
    rendererPreference?: 'webgl' | 'webgpu',
  ): Promise<void>;
} = {
  async setPixiRendererPreference(preference: 'webgl' | 'webgpu') {
    pixiRendererPreference = preference;
  },

  async extractMetadata(file: File | FileSystemFileHandle): Promise<MediaMetadata> {
    return parseMediaMetadata(await extractMetadata(file));
  },

  async initCompositor(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    bgColor: string,
    rendererPreference: 'webgl' | 'webgpu' = 'webgl',
  ) {
    pixiRendererPreference = rendererPreference;
    const nextCompositor = new VideoCompositor();
    await nextCompositor.init(width, height, bgColor, true, canvas, {
      rendererPreference,
    });

    if (compositor) {
      compositor.destroy();
    }
    compositor = nextCompositor;
  },

  async loadTimeline(
    clips: import('../composables/timeline/export/types').WorkerVideoPayloadItem[],
    requestId?: number,
  ) {
    if (!compositor) throw new Error('Compositor not initialized');
    if (typeof requestId === 'number' && Number.isFinite(requestId)) {
      latestLoadTimelineRequestId = requestId;
    }
    const isStaleRequest = () =>
      typeof requestId === 'number' &&
      Number.isFinite(requestId) &&
      requestId !== latestLoadTimelineRequestId;
    return compositor.loadTimeline(
      clips,
      {
        getFileHandleByPath: async (path: string) => {
          if (!hostClient) return null;
          return hostClient.getFileHandleByPath(path);
        },
        getFileByPath: async (path: string) => {
          if (!hostClient?.getFileByPath) return null;
          return hostClient.getFileByPath(path);
        },
        getCurrentProjectId: async () => {
          if (!hostClient) return null;
          return await hostClient.getCurrentProjectId();
        },
        ensureVectorImageRaster: async (params) => {
          if (!hostClient) return null;
          return await hostClient.ensureVectorImageRaster(params);
        },
      },
      isStaleRequest,
    );
  },

  async updateTimelineLayout(
    clips: import('../composables/timeline/export/types').WorkerVideoPayloadItem[],
  ) {
    if (!compositor) throw new Error('Compositor not initialized');
    return compositor.updateTimelineLayout(clips);
  },

  async renderFrame(timeUs: number, options?: PreviewRenderOptions) {
    if (!compositor) return null;
    latestRenderTimeUs = Math.round(Number(timeUs) || 0);
    latestPreviewOptions = options ? PreviewRenderOptionsSchema.parse(options) : undefined;
    if (renderInFlight) return null;

    renderInFlight = true;
    try {
      while (latestRenderTimeUs !== null) {
        const next = latestRenderTimeUs;
        const opt = latestPreviewOptions;
        latestRenderTimeUs = null;
        latestPreviewOptions = undefined;
        try {
          await compositor.renderFrame(next, opt);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') break;
          console.error('[Worker] renderFrame error at time', next, err);
        }
      }
      return null;
    } finally {
      renderInFlight = false;
      latestRenderTimeUs = null;
      latestPreviewOptions = undefined;
    }
  },

  async clearClips() {
    if (!compositor) return;
    compositor.clearClips();
  },

  async destroyCompositor() {
    if (compositor) {
      compositor.destroy();
      compositor = null;
    }
  },

  async exportTimeline(
    targetHandle: FileSystemFileHandle,
    options: import('../composables/timeline/export/types').ExportOptions,
    timelineClips: import('../composables/timeline/export/types').WorkerVideoPayloadItem[],
    audioClips: import('../composables/timeline/export/types').WorkerTimelineClip[] = [],
    taskId?: string,
  ) {
    if (taskId) {
      if (!activeCancels.has(taskId)) {
        activeCancels.set(taskId, false);
      }
    } else {
      cancelExportRequested = false;
    }

    try {
      await runExport(
        targetHandle,
        ExportOptionsSchema.parse(options),
        timelineClips,
        audioClips,
        hostClient,
        (msg) => reportExportWarning(msg, taskId),
        () => {
          if (taskId) return activeCancels.get(taskId) === true;
          return cancelExportRequested;
        },
        taskId,
        pixiRendererPreference,
      );
    } finally {
      if (taskId) {
        activeCancels.delete(taskId);
      }
    }
  },

  async transcodeMedia(
    sourceFile: File | FileSystemFileHandle,
    targetHandle: FileSystemFileHandle,
    options: import('../composables/timeline/export/types').ExportOptions,
    taskId?: string,
  ) {
    if (taskId) {
      activeCancels.set(taskId, false);
    } else {
      cancelExportRequested = false;
    }

    await runTranscode(
      sourceFile,
      targetHandle,
      ExportOptionsSchema.parse(options),
      hostClient,
      (msg) => reportExportWarning(msg, taskId),
      () => {
        if (taskId) return activeCancels.get(taskId) === true;
        return cancelExportRequested;
      },
      taskId,
    );

    if (taskId) {
      activeCancels.delete(taskId);
    }
  },

  async cancelExport(taskId?: string) {
    if (taskId) {
      activeCancels.set(taskId, true);
      disposeFrameExtractor(taskId);
    } else {
      cancelExportRequested = true;
    }
  },

  async extractFrameToBlob(
    timeUs: number,
    width: number,
    height: number,
    timelineClips: import('../composables/timeline/export/types').WorkerVideoPayloadItem[],
    quality: number,
  ) {
    const localCompositor = new VideoCompositor();
    await localCompositor.init(width, height, '#000', true, undefined, {
      rendererPreference: pixiRendererPreference,
    });

    try {
      await localCompositor.loadTimeline(
        timelineClips,
        {
          getFileHandleByPath: async (path) => {
            if (!hostClient) return null;
            return hostClient.getFileHandleByPath(path);
          },
          getFileByPath: async (path: string) => {
            if (!hostClient?.getFileByPath) return null;
            return hostClient.getFileByPath(path);
          },
          getCurrentProjectId: async () => {
            if (!hostClient) return null;
            return await hostClient.getCurrentProjectId();
          },
          ensureVectorImageRaster: async (params) => {
            if (!hostClient) return null;
            return await hostClient.ensureVectorImageRaster(params);
          },
        },
        () => false,
      );

      const canvas = await localCompositor.renderFrame(timeUs);
      if (!canvas) {
        throw new Error('Failed to render frame');
      }

      const blob = await (canvas as OffscreenCanvas).convertToBlob({
        type: 'image/webp',
        quality: Math.max(0.01, Math.min(1, quality)),
      });
      return blob;
    } finally {
      localCompositor.destroy();
    }
  },

  async extractVideoFrameBlobs(
    file: File,
    options: {
      timesS: number[];
      maxWidth: number;
      maxHeight: number;
      quality: number;
      mimeType: string;
      taskId?: string;
      keepAlive?: boolean;
    },
  ): Promise<(Blob | null)[]> {
    const taskId = options.taskId;
    if (taskId && !activeCancels.has(taskId)) {
      activeCancels.set(taskId, false);
    }

    const isCancelled = () => (taskId ? activeCancels.get(taskId) === true : false);

    let state: FrameExtractorState | null = null;
    let createdHere = false;

    try {
      state = taskId ? (frameExtractors.get(taskId) ?? null) : null;
      if (!state) {
        state = await createFrameExtractorState(file);
        createdHere = true;
        if (taskId && options.keepAlive !== false && state.sink) {
          frameExtractors.set(taskId, state);
          createdHere = false;
        }
      }

      if (!state.sink) {
        return options.timesS.map(() => null);
      }

      const { sink, firstTimestampS } = state;
      const results: (Blob | null)[] = [];

      for (const targetS of options.timesS) {
        if (isCancelled()) {
          throw new Error('Thumbnail extraction cancelled');
        }

        const safeTimeS = Math.max(firstTimestampS, targetS);

        let sample: unknown = null;
        try {
          sample = await (sink as { getSample: (timeS: number) => Promise<unknown> }).getSample(
            safeTimeS,
          );
          if (!sample && firstTimestampS > 0) {
            sample = await (sink as { getSample: (timeS: number) => Promise<unknown> }).getSample(
              firstTimestampS,
            );
          }
          if (!sample && safeTimeS !== 0) {
            sample = await (sink as { getSample: (timeS: number) => Promise<unknown> }).getSample(
              1e-6,
            );
          }
        } catch {
          results.push(null);
          continue;
        }

        if (!sample) {
          results.push(null);
          continue;
        }

        let blob: Blob | null = null;
        try {
          const isVideoFrame = typeof VideoFrame !== 'undefined' && sample instanceof VideoFrame;

          const imageSource: CanvasImageSource | null = isVideoFrame
            ? (sample as VideoFrame)
            : typeof (sample as { toCanvasImageSource?: () => CanvasImageSource })
                  .toCanvasImageSource === 'function'
              ? (sample as { toCanvasImageSource?: () => CanvasImageSource }).toCanvasImageSource()
              : null;

          if (!imageSource) {
            results.push(null);
            continue;
          }

          const rawW: number = isVideoFrame
            ? (sample as VideoFrame).displayWidth
            : ((imageSource as CanvasImageSource & { displayWidth?: number; width?: number })
                .displayWidth ??
              (imageSource as CanvasImageSource & { displayWidth?: number; width?: number })
                .width ??
              0);
          const rawH: number = isVideoFrame
            ? (sample as VideoFrame).displayHeight
            : ((imageSource as CanvasImageSource & { displayHeight?: number; height?: number })
                .displayHeight ??
              (imageSource as CanvasImageSource & { displayHeight?: number; height?: number })
                .height ??
              0);

          if (!rawW || !rawH) {
            results.push(null);
            continue;
          }

          const rotation = normalizeRotation(state.rotation);
          const isQuarterTurn = rotation === 90 || rotation === 270;
          const visualW = isQuarterTurn ? rawH : rawW;
          const visualH = isQuarterTurn ? rawW : rawH;

          let targetW = visualW;
          let targetH = visualH;
          if (targetW > options.maxWidth || targetH > options.maxHeight) {
            const scaleW = options.maxWidth / targetW;
            const scaleH = options.maxHeight / targetH;
            const scale = Math.min(scaleW, scaleH);
            targetW = Math.round(targetW * scale);
            targetH = Math.round(targetH * scale);
          }

          if (!state.canvas) {
            state.canvas = new OffscreenCanvas(targetW, targetH);
            state.ctx = state.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
          } else {
            state.canvas.width = targetW;
            state.canvas.height = targetH;
          }

          if (!state.ctx) {
            results.push(null);
            continue;
          }

          drawRotatedThumbnailFrame({
            ctx: state.ctx,
            imageSource,
            rotation,
            targetW,
            targetH,
          });
          blob = await state.canvas.convertToBlob({
            type: options.mimeType,
            quality: options.quality,
          });
        } finally {
          if (typeof sample.close === 'function') {
            try {
              sample.close();
            } catch {
              // ignore
            }
          }
        }

        results.push(blob);
      }

      return results;
    } finally {
      if (createdHere && state) {
        disposeFrameExtractorState(state);
      }
      if (taskId && options.keepAlive === false) {
        disposeFrameExtractor(taskId);
        activeCancels.delete(taskId);
      }
    }
  },

  async releaseFrameExtractor(taskId: string) {
    if (!taskId) return;
    disposeFrameExtractor(taskId);
    activeCancels.delete(taskId);
  },

  async extractAudio(sourcePath: string, targetPath: string) {
    cancelExportRequested = false;
    await extractAudioStream(
      sourcePath,
      targetPath,
      hostClient,
      reportExportWarning,
      () => cancelExportRequested,
    );
  },
};

const activeCancels = new Map<string, boolean>();

interface FrameExtractorState {
  source: unknown;
  input: unknown;
  sink: {
    getSample: (timeS: number) => Promise<unknown>;
    close?: () => void;
    dispose?: () => void;
  } | null;
  firstTimestampS: number;
  rotation: number;
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
}

const frameExtractors = new Map<string, FrameExtractorState>();

async function createFrameExtractorState(file: File): Promise<FrameExtractorState> {
  const { Input, BlobSource, VideoSampleSink, ALL_FORMATS } = await import('mediabunny');
  const source = new BlobSource(file);
  const input = new Input({ source, formats: ALL_FORMATS } as unknown);
  const track = await input.getPrimaryVideoTrack();

  if (!track || !(await track.canDecode())) {
    return {
      source,
      input,
      sink: null,
      firstTimestampS: 0,
      rotation: 0,
      canvas: null,
      ctx: null,
    };
  }

  const firstTimestampS: number =
    typeof (track as unknown as { getFirstTimestamp?: () => Promise<number> }).getFirstTimestamp ===
    'function'
      ? await (
          track as unknown as { getFirstTimestamp?: () => Promise<number> }
        ).getFirstTimestamp()
      : 0;

  return {
    source,
    input,
    sink: new VideoSampleSink(track),
    firstTimestampS,
    rotation: Number((track as { rotation?: unknown }).rotation) || 0,
    canvas: null,
    ctx: null,
  };
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) return 90;
  if (normalized >= 135 && normalized < 225) return 180;
  if (normalized >= 225 && normalized < 315) return 270;
  return 0;
}

function drawRotatedThumbnailFrame(input: {
  ctx: OffscreenCanvasRenderingContext2D;
  imageSource: CanvasImageSource;
  rotation: 0 | 90 | 180 | 270;
  targetW: number;
  targetH: number;
}): void {
  const { ctx, imageSource, rotation, targetW, targetH } = input;

  ctx.save();
  ctx.clearRect(0, 0, targetW, targetH);

  if (rotation === 90) {
    ctx.translate(targetW, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(imageSource, 0, 0, targetH, targetW);
  } else if (rotation === 180) {
    ctx.translate(targetW, targetH);
    ctx.rotate(Math.PI);
    ctx.drawImage(imageSource, 0, 0, targetW, targetH);
  } else if (rotation === 270) {
    ctx.translate(0, targetH);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(imageSource, 0, 0, targetH, targetW);
  } else {
    ctx.drawImage(imageSource, 0, 0, targetW, targetH);
  }

  ctx.restore();
}

function disposeFrameExtractorState(state: FrameExtractorState): void {
  const sink = state.sink;
  if (sink) {
    try {
      if (typeof sink.close === 'function') sink.close();
      else if (typeof sink.dispose === 'function') sink.dispose();
    } catch {
      // ignore
    }
  }
  const input = state.input;
  if (input) {
    try {
      if (typeof input.dispose === 'function') input.dispose();
      else if (typeof input.close === 'function') input.close();
    } catch {
      // ignore
    }
  }
  state.sink = null;
  state.input = null;
  state.source = null;
  state.canvas = null;
  state.ctx = null;
}

function disposeFrameExtractor(taskId: string): void {
  const state = frameExtractors.get(taskId);
  if (!state) return;
  frameExtractors.delete(taskId);
  disposeFrameExtractorState(state);
}

let callIdCounter = 0;
const pendingCalls = new Map<number, WorkerPendingCall>();

self.addEventListener('message', async (e: MessageEvent<VideoCoreWorkerRpcMessage>) => {
  const data = e.data;
  if (!data) return;

  if (data.type === 'rpc-response') {
    const pending = pendingCalls.get(data.id);
    if (pending) {
      if (pending.timeoutId !== undefined) self.clearTimeout(pending.timeoutId);
      if (data.error) pending.reject(normalizeRpcError(data.error));
      else pending.resolve(data.result);
      pendingCalls.delete(data.id);
    }
  } else if (data.type === 'rpc-call') {
    try {
      const result = await callWorkerMethod(data.method, data.args);
      self.postMessage({ type: 'rpc-response', id: data.id, method: data.method, result });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const isUnsupportedFormat =
        error.message?.includes('unsupported') || error.message?.includes('unrecognizable');
      if (error?.name !== 'AbortError') {
        if (isUnsupportedFormat) {
          console.warn(`[Worker] Unsupported format in method ${data.method}:`, error.message);
        } else {
          console.error(`[Worker] Error in method ${data.method}:`, err);
        }
      }
      self.postMessage({
        type: 'rpc-response',
        id: data.id,
        method: data.method,
        error: serializeWorkerError(err),
      });
    }
  }
});

hostClient = new Proxy(
  {},
  {
    get(_, method: keyof VideoCoreHostAPI) {
      return async (...args: unknown[]) => {
        return new Promise((resolve, reject) => {
          const max = Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_WORKER_RPC_PENDING_CALLS));
          if (pendingCalls.size >= max) {
            const err = new Error('Host RPC queue overflow');
            err.name = 'HostQueueOverflowError';
            reject(err);
            return;
          }
          const id = (callIdCounter = (callIdCounter + 1) % Number.MAX_SAFE_INTEGER);
          const timeoutId = self.setTimeout(() => {
            const p = pendingCalls.get(id);
            if (p) {
              pendingCalls.delete(id);
              p.reject(new Error(`Host RPC timeout for method: ${method}`));
            }
          }, 30000);

          pendingCalls.set(id, { resolve, reject, timeoutId });
          const { message } = createHostRpcCall(method, args);
          self.postMessage({ ...message, id } as VideoCoreHostRpcMessage);
        });
      };
    },
  },
) as VideoCoreHostAPI;
