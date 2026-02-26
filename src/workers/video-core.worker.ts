import './worker-polyfill';
import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

import type { VideoCoreHostAPI } from '../utils/video-editor/worker-client';
import { VideoCompositor } from '../utils/video-editor/VideoCompositor';
import { initEffects } from '../effects';
import { initTransitions } from '../transitions';
import { normalizeRpcError } from './core/utils';
import { extractMetadata, runExport } from './core/export';
import { VIDEO_CORE_LIMITS } from '../utils/constants';

DOMAdapter.set(WebWorkerAdapter);
initEffects();
initTransitions();

let hostClient: VideoCoreHostAPI | null = null;
let compositor: VideoCompositor | null = null;
let cancelExportRequested = false;

let renderInFlight = false;
let latestRenderTimeUs: number | null = null;

async function reportExportWarning(message: string) {
  console.warn(message);
  if (!hostClient) return;
  try {
    await (hostClient as any).onExportWarning?.(message);
  } catch {
    // ignore
  }
}

const api: any = {
  extractMetadata,

  async initCompositor(canvas: OffscreenCanvas, width: number, height: number, bgColor: string) {
    if (compositor) {
      compositor.destroy();
      compositor = null;
    }

    compositor = new VideoCompositor();
    await compositor.init(width, height, bgColor, true, canvas);
  },

  async loadTimeline(clips: any[]) {
    if (!compositor) throw new Error('Compositor not initialized');
    return compositor.loadTimeline(clips, async (path: string) => {
      if (!hostClient) return null;
      return hostClient.getFileHandleByPath(path);
    });
  },

  async updateTimelineLayout(clips: any[]) {
    if (!compositor) throw new Error('Compositor not initialized');
    return compositor.updateTimelineLayout(clips);
  },

  async renderFrame(timeUs: number) {
    if (!compositor) return;
    latestRenderTimeUs = Math.round(Number(timeUs) || 0);
    if (renderInFlight) return;

    renderInFlight = true;
    try {
      while (latestRenderTimeUs !== null) {
        const next = latestRenderTimeUs;
        latestRenderTimeUs = null;
        await compositor.renderFrame(next);
      }
    } finally {
      renderInFlight = false;
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
  ) {
    cancelExportRequested = false;
    await runExport(
      targetHandle,
      options,
      timelineClips,
      audioClips,
      hostClient,
      reportExportWarning,
      () => cancelExportRequested,
    );
  },

  async cancelExport() {
    cancelExportRequested = true;
  },
};

let callIdCounter = 0;
const pendingCalls = new Map<number, { resolve: Function; reject: Function }>();

self.addEventListener('message', async (e: any) => {
  const data = e.data;
  if (!data) return;

  if (data.type === 'rpc-response') {
    const pending = pendingCalls.get(data.id);
    if (pending) {
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
      console.error(`[Worker] Error in method ${data.method}:`, err);
      self.postMessage({
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
          const id = ++callIdCounter;
          pendingCalls.set(id, { resolve, reject });
          self.postMessage({ type: 'rpc-call', id, method, args });
        });
      };
    },
  },
) as VideoCoreHostAPI;
