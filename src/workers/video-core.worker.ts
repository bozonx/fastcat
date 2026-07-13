import { createDevLogger } from '~/utils/dev-logger';
import './worker-polyfill';
import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

import type { VideoCoreHostAPI } from '../utils/video-editor/worker-client';
import { VideoCompositor } from '../utils/video-editor/VideoCompositor';
import { compositorPerfStats } from '../utils/video-editor/compositor/CompositorPerfStats';
import { parseMediaMetadata, PreviewRenderOptionsSchema } from '../utils/video-editor/worker-rpc';
import type {
  PreviewRenderOptions,
  VideoCoreHostRpcMessage,
  VideoCoreWorkerAPI,
  VideoCoreWorkerRpcMessage,
} from '../utils/video-editor/worker-rpc';
import type { MediaMetadata } from '../types/media';
import {
  ExportOptionsSchema,
  parseWorkerVideoPayload,
  TranscodeOptionsSchema,
} from '../types/worker-payload';
import { initEffects } from '../effects';
import { initTransitions } from '../transitions';
import { normalizeRpcError } from './core/utils';
import { governedBlobWorker } from '~/utils/io/governed-blob-worker';
import {
  normalizeRotation,
  getThumbnailSourceWidth,
  getThumbnailSourceHeight,
  drawRotatedThumbnailFrame,
  serializeWorkerError,
  disposeFrameExtractorState,
  runRenderRetryLoop,
  type FrameExtractorState,
  type RenderRetryLoopDriver,
} from './video-core-helpers';
import { extractMetadata, runExport, extractAudioStream } from './core/export';
import { runTranscode } from './core/transcode';
import { PIXI_RENDERER_PREFERENCE, VIDEO_CORE_LIMITS } from '../utils/constants';
import { loadFonts } from '../utils/video-editor/load-fonts';
import { isTauriRuntime } from '~/utils/runtime';
const log = createDevLogger('video-core.worker');

DOMAdapter.set(WebWorkerAdapter);
initEffects();
initTransitions();

let hostClient: VideoCoreHostAPI | null = null;
let compositor: VideoCompositor | null = null;
let cancelExportRequested = false;
let latestLoadTimelineRequestId = 0;
let pixiRendererPreference: 'webgl' | 'webgpu' = PIXI_RENDERER_PREFERENCE;

let renderInFlight = false;
let latestRenderTimeUs: number | null = null;
let latestPreviewOptions: PreviewRenderOptions | undefined;

type WorkerPendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId?: number;
};

type WorkerMethod = keyof VideoCoreWorkerAPI;

/**
 * Generic RPC dispatch. Every worker method is implemented on the `api` object
 * below, and each method performs its own input validation (e.g. `renderFrame`
 * and `extractMetadata` parse their payloads internally, `loadTimeline` runs
 * `parseWorkerVideoPayload`). So dispatch is a single typed lookup instead of a
 * per-method switch that had to be kept in sync with the interface by hand.
 */
async function callWorkerMethod<K extends WorkerMethod>(
  method: K,
  args: Parameters<VideoCoreWorkerAPI[K]>,
): Promise<Awaited<ReturnType<VideoCoreWorkerAPI[K]>>> {
  const handler = (api as Record<string, (...handlerArgs: unknown[]) => unknown>)[method];
  if (typeof handler !== 'function') {
    throw new Error(`Unsupported worker method: ${String(method)}`);
  }
  return (await handler(...(args as unknown[]))) as Awaited<ReturnType<VideoCoreWorkerAPI[K]>>;
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
  log.warn(message, taskId ? `[task:${taskId}]` : '');
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
    designWidth?: number,
    designHeight?: number,
  ): Promise<void>;
} = {
  async setPixiRendererPreference(preference: 'webgl' | 'webgpu') {
    pixiRendererPreference = preference;
  },

  async getCompositorPerfSnapshot() {
    return compositorPerfStats.snapshot();
  },

  async checkWebGpuSupport(): Promise<{ supported: boolean; error: string | null }> {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      return {
        supported: false,
        error: 'WebGPU API (navigator.gpu) is undefined in Worker context',
      };
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return { supported: false, error: 'requestAdapter() returned null' };
      }
      const device = await adapter.requestDevice();
      device.destroy?.();
      return { supported: true, error: null };
    } catch (err) {
      return { supported: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async extractMetadata(file: File | FileSystemFileHandle): Promise<MediaMetadata> {
    return parseMediaMetadata(await extractMetadata(file));
  },

  async initCompositor(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    bgColor: string,
    rendererPreference: 'webgl' | 'webgpu' = PIXI_RENDERER_PREFERENCE,
    designWidth?: number,
    designHeight?: number,
  ) {
    if (isTauriRuntime()) {
      throw new Error('JS video core is disabled in Tauri runtime');
    }
    await loadFonts();
    pixiRendererPreference = rendererPreference;
    const nextCompositor = new VideoCompositor();
    await nextCompositor.init(width, height, bgColor, true, canvas, {
      rendererPreference,
      designWidth,
      designHeight,
    });

    if (compositor) {
      await compositor.destroy();
    }
    compositor = nextCompositor;
  },

  /**
   * Full rebuild of the compositor timeline. Cancels any in-flight load and
   * re-creates clip sprites, textures, and media decoders from scratch.
   * Use this when the clip set itself changes (add/remove/reorder clips).
   */
  async loadTimeline(
    clips: import('../composables/timeline/export/types').WorkerVideoPayloadItem[],
    requestId?: number,
  ) {
    // In Tauri mode the web compositor is not initialized (native monitor draws preview).
    if (!compositor) return 0;

    const validatedClips = parseWorkerVideoPayload(clips);

    if (typeof requestId === 'number' && Number.isFinite(requestId)) {
      latestLoadTimelineRequestId = requestId;
    }
    const isStaleRequest = () =>
      typeof requestId === 'number' &&
      Number.isFinite(requestId) &&
      requestId !== latestLoadTimelineRequestId;
    return compositor.loadTimeline(
      validatedClips,
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

  /**
   * Incremental layout update. Mutates existing clip positions, durations, and
   * effects without destroying and re-creating sprites or media decoders.
   * Use this when only clip properties (trim, position, opacity, etc.) change.
   */
  async updateTimelineLayout(
    clips: import('../composables/timeline/export/types').WorkerVideoPayloadItem[],
  ) {
    // In Tauri mode the web compositor is not initialized; return 0 so the
    // audio side still recomputes duration.
    if (!compositor) return 0;

    const validatedClips = parseWorkerVideoPayload(clips);
    return compositor.updateTimelineLayout(validatedClips);
  },

  async renderFrame(timeUs: number, options?: PreviewRenderOptions) {
    if (!compositor) return null;
    latestRenderTimeUs = Math.round(Number(timeUs) || 0);
    latestPreviewOptions = options ? PreviewRenderOptionsSchema.parse(options) : undefined;
    if (renderInFlight) return null;

    renderInFlight = true;
    // The retry loop itself is a pure function (video-core-helpers.ts) so it can
    // be unit-tested without a Pixi/worker context; this driver wires it to the
    // module-level `latest*` mailbox, which a concurrent renderFrame RPC call
    // mutates at any await point to supersede the in-flight request.
    const driver: RenderRetryLoopDriver = {
      takeQueued: () => {
        if (latestRenderTimeUs === null) return null;
        const timeUs = latestRenderTimeUs;
        const options = latestPreviewOptions;
        latestRenderTimeUs = null;
        latestPreviewOptions = undefined;
        return { timeUs, options };
      },
      hasQueued: () => latestRenderTimeUs !== null,
      queueRetry: (timeUs) => {
        latestRenderTimeUs = timeUs;
      },
      render: (timeUs, options) =>
        compositor!.renderFrame(timeUs, options as PreviewRenderOptions | undefined),
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isActive: () => compositor !== null,
      onError: (timeUs, err) => log.error('[Worker] renderFrame error at time', timeUs, err),
    };

    try {
      return await runRenderRetryLoop(driver);
    } finally {
      renderInFlight = false;
      latestRenderTimeUs = null;
      latestPreviewOptions = undefined;
    }
  },

  async prewarmVideoFrames(timeUs: number, lookaheadUs?: number) {
    if (!compositor) return;
    await compositor.prewarmVideoFrames(timeUs, lookaheadUs);
  },

  async clearClips() {
    if (!compositor) return;
    await compositor.clearClips();
  },

  async destroyCompositor() {
    if (compositor) {
      await compositor.destroy();
      compositor = null;
    }
  },

  async exportTimeline(
    targetHandle: FileSystemFileHandle,
    options: import('../composables/timeline/export/types').ExportOptions,
    timelineClips: import('../composables/timeline/export/types').WorkerVideoPayloadItem[],
    audioClips: import('../composables/timeline/export/types').WorkerTimelineClip[] = [],
    taskId?: string,
    masterAudioEffects?: import('../utils/audio/apply-audio-effects-offline').AudioEffectData[],
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
        masterAudioEffects,
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
    options: import('../composables/timeline/export/types').TranscodeOptions,
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
      TranscodeOptionsSchema.parse(options),
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
    isTransparent = false,
    effectQuality?: import('../utils/preview-effect-quality').PreviewEffectQuality,
  ) {
    await loadFonts();
    const localCompositor = new VideoCompositor();
    try {
      await localCompositor.init(
        width,
        height,
        isTransparent ? 'transparent' : '#000',
        true,
        undefined,
        {
          rendererPreference: pixiRendererPreference,
        },
      );
    } catch (initErr) {
      log.warn('[Worker] extractFrameToBlob: compositor init failed', initErr);
      await localCompositor.destroy().catch(() => {});
      return null;
    }

    if (effectQuality) {
      localCompositor.setPreviewEffectQuality(effectQuality);
    }

    try {
      await localCompositor.loadTimeline(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        timelineClips as any,
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
      await localCompositor.destroy();
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
        } catch (err) {
          log.error('[Worker] Failed to get video sample at time', safeTimeS, err);
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
              ? ((
                  sample as { toCanvasImageSource?: () => CanvasImageSource }
                ).toCanvasImageSource?.() ?? null)
              : null;

          if (!imageSource) {
            results.push(null);
            continue;
          }

          const rotation = normalizeRotation(state.rotation);
          const rawW = getThumbnailSourceWidth(imageSource, sample, rotation);
          const rawH = getThumbnailSourceHeight(imageSource, sample, rotation);

          if (!rawW || !rawH) {
            results.push(null);
            continue;
          }

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const closeFn = (sample as any).close;
          if (typeof closeFn === 'function') {
            try {
              closeFn.call(sample);
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
      if (taskId && (options.keepAlive === false || activeCancels.get(taskId) === true)) {
        // Also consume a cancellation that landed during this batch: for a
        // keepAlive extractor the flag used to outlive the cancelled batch, so
        // any later batch reusing the same taskId aborted instantly before
        // doing any work.
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

const frameExtractors = new Map<string, FrameExtractorState>();

async function createFrameExtractorState(file: File): Promise<FrameExtractorState> {
  const { Input, BlobSource, VideoSampleSink, ALL_FORMATS } = await import('mediabunny');
  const source = new BlobSource(governedBlobWorker(file));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = new Input({ source, formats: ALL_FORMATS } as any);
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
      ? ((await (
          track as unknown as { getFirstTimestamp?: () => Promise<number> }
        ).getFirstTimestamp?.()) ?? 0)
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
          log.warn(`[Worker] Unsupported format in method ${data.method}:`, error.message);
        } else {
          log.error(`[Worker] Error in method ${data.method}:`, err);
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
