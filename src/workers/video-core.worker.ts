import './worker-polyfill';
import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

import type { VideoCoreHostAPI } from '../utils/video-editor/worker-client';
import { VideoCompositor } from '../utils/video-editor/VideoCompositor';
import type { PreviewRenderOptions } from '../utils/video-editor/worker-rpc';
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

let renderInFlight = false;
let latestRenderTimeUs: number | null = null;
let latestPreviewOptions: PreviewRenderOptions | undefined;

async function reportExportWarning(message: string, taskId?: string) {
  console.warn(message, taskId ? `[task:${taskId}]` : '');
  if (!hostClient) return;
  try {
    await (hostClient as any).onExportWarning?.(message, taskId);
  } catch {
    // ignore
  }
}

const api: any = {
  extractMetadata,

  async initCompositor(canvas: OffscreenCanvas, width: number, height: number, bgColor: string) {
    const nextCompositor = new VideoCompositor();
    await nextCompositor.init(width, height, bgColor, true, canvas);

    if (compositor) {
      compositor.destroy();
    }
    compositor = nextCompositor;
  },

  async loadTimeline(clips: any[]) {
    if (!compositor) throw new Error('Compositor not initialized');
    return compositor.loadTimeline(clips, {
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
    });
  },

  async updateTimelineLayout(clips: any[]) {
    if (!compositor) throw new Error('Compositor not initialized');
    return compositor.updateTimelineLayout(clips);
  },

  async renderFrame(timeUs: number, options?: PreviewRenderOptions) {
    if (!compositor) return;
    latestRenderTimeUs = Math.round(Number(timeUs) || 0);
    latestPreviewOptions = options;
    if (renderInFlight) return;

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
          if ((err as any)?.name === 'AbortError') break;
          console.error('[Worker] renderFrame error at time', next, err);
        }
      }
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
    options: any,
    timelineClips: any[],
    audioClips: any[] = [],
    taskId?: string,
  ) {
    if (taskId) {
      activeCancels.set(taskId, false);
    } else {
      cancelExportRequested = false;
    }

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
    );

    if (taskId) {
      activeCancels.delete(taskId);
    }
  },

  async transcodeMedia(
    sourceFile: File | FileSystemFileHandle,
    targetHandle: FileSystemFileHandle,
    options: any,
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
    } else {
      cancelExportRequested = true;
    }
  },

  async extractFrameToBlob(
    timeUs: number,
    width: number,
    height: number,
    timelineClips: any[],
    quality: number,
  ) {
    const localCompositor = new VideoCompositor();
    await localCompositor.init(width, height, '#000', true);

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
    },
  ): Promise<(Blob | null)[]> {
    const { Input, BlobSource, VideoSampleSink, ALL_FORMATS } = await import('mediabunny');

    const source = new BlobSource(file);
    const input = new Input({ source, formats: ALL_FORMATS } as any);

    try {
      const track = await input.getPrimaryVideoTrack();

      if (!track || !(await track.canDecode())) {
        return options.timesS.map(() => null);
      }

      const firstTimestampS: number =
        typeof (track as any).getFirstTimestamp === 'function'
          ? await (track as any).getFirstTimestamp()
          : 0;

      const sink = new VideoSampleSink(track);

      let sharedCanvas: OffscreenCanvas | null = null;
      let sharedCtx: OffscreenCanvasRenderingContext2D | null = null;

      try {
        const results: (Blob | null)[] = [];

        for (const targetS of options.timesS) {
          const safeTimeS = Math.max(firstTimestampS, targetS);

          let sample: any = null;
          try {
            sample = await (sink as any).getSample(safeTimeS);
            if (!sample && firstTimestampS > 0) {
              sample = await (sink as any).getSample(firstTimestampS);
            }
            if (!sample && safeTimeS !== 0) {
              sample = await (sink as any).getSample(1e-6);
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
              : typeof (sample as any).toCanvasImageSource === 'function'
                ? (sample as any).toCanvasImageSource()
                : null;

            if (!imageSource) {
              results.push(null);
              continue;
            }

            const rawW: number = isVideoFrame
              ? (sample as VideoFrame).displayWidth
              : ((imageSource as any).displayWidth ?? (imageSource as any).width ?? 0);
            const rawH: number = isVideoFrame
              ? (sample as VideoFrame).displayHeight
              : ((imageSource as any).displayHeight ?? (imageSource as any).height ?? 0);

            if (!rawW || !rawH) {
              results.push(null);
              continue;
            }

            let targetW = rawW;
            let targetH = rawH;
            if (targetW > options.maxWidth || targetH > options.maxHeight) {
              const scaleW = options.maxWidth / targetW;
              const scaleH = options.maxHeight / targetH;
              const scale = Math.min(scaleW, scaleH);
              targetW = Math.round(targetW * scale);
              targetH = Math.round(targetH * scale);
            }

            if (!sharedCanvas) {
              sharedCanvas = new OffscreenCanvas(targetW, targetH);
              sharedCtx = sharedCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
            } else {
              sharedCanvas.width = targetW;
              sharedCanvas.height = targetH;
            }

            if (!sharedCtx) {
              results.push(null);
              continue;
            }

            sharedCtx.drawImage(imageSource, 0, 0, targetW, targetH);
            blob = await sharedCanvas.convertToBlob({
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
        if (typeof (sink as any).close === 'function') {
          try {
            (sink as any).close();
          } catch {
            // ignore
          }
        } else if (typeof (sink as any).dispose === 'function') {
          try {
            (sink as any).dispose();
          } catch {
            // ignore
          }
        }
      }
    } finally {
      if (typeof (input as any).dispose === 'function') {
        try {
          (input as any).dispose();
        } catch {
          // ignore
        }
      } else if (typeof (input as any).close === 'function') {
        try {
          (input as any).close();
        } catch {
          // ignore
        }
      }
    }
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

let callIdCounter = 0;
const pendingCalls = new Map<number, { resolve: Function; reject: Function; timeoutId?: number }>();

self.addEventListener('message', async (e: any) => {
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
      const method = data.method;
      if (typeof api[method] !== 'function') {
        throw new Error(`Method ${method} not found on Worker API`);
      }
      const result = await api[method](...(data.args || []));
      self.postMessage({ type: 'rpc-response', id: data.id, result });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error(`[Worker] Error in method ${data.method}:`, err);
      }
      self.postMessage({
        type: 'rpc-response',
        id: data.id,
        error: {
          name: err?.name || 'Error',
          message: err?.message || String(err),
          cause: err?.cause,
          stack: err?.stack,
        },
      });
    }
  }
});

hostClient = new Proxy(
  {},
  {
    get(_, method: string) {
      return async (...args: any[]) => {
        return new Promise((resolve, reject) => {
          const max = Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_WORKER_RPC_PENDING_CALLS));
          if (pendingCalls.size >= max) {
            const err = new Error('Host RPC queue overflow');
            (err as any).name = 'HostQueueOverflowError';
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

          // If the last argument is a taskId (string and doesn't look like path), we move it to the envelope
          // Actually, we should check if the called method is one of the progress/phase/warning ones
          let taskId: string | undefined;
          if (
            method === 'onExportProgress' ||
            method === 'onExportPhase' ||
            method === 'onExportWarning'
          ) {
            // These methods are now called with (value, taskId) from runExport
            if (args.length >= 2 && typeof args[args.length - 1] === 'string') {
              taskId = args.pop();
            }
          }

          pendingCalls.set(id, { resolve, reject, timeoutId });
          self.postMessage({ type: 'rpc-call', id, method, args, taskId });
        });
      };
    },
  },
) as VideoCoreHostAPI;
