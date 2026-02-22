import './worker-polyfill';

import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

import type { VideoCoreHostAPI } from '../utils/video-editor/worker-client';
import type { VideoCoreWorkerAPI } from '../utils/video-editor/worker-rpc';
import { VideoCompositor } from '../utils/video-editor/VideoCompositor';
DOMAdapter.set(WebWorkerAdapter);

let hostClient: VideoCoreHostAPI | null = null;
let compositor: VideoCompositor | null = null;
let cancelExportRequested = false;

function normalizeRpcError(errData: any): Error {
  if (!errData) return new Error('Worker RPC error');
  if (typeof errData === 'string') return new Error(errData);
  const message = typeof errData?.message === 'string' ? errData.message : 'Worker RPC error';
  const err = new Error(message);
  if (typeof errData?.name === 'string') (err as any).name = errData.name;
  if (typeof errData?.stack === 'string') (err as any).stack = errData.stack;
  return err;
}

function getBunnyVideoCodec(codec: string): any {
  if (codec.startsWith('avc1')) return 'avc';
  if (codec.startsWith('hvc1') || codec.startsWith('hev1')) return 'hevc';
  if (codec.startsWith('vp8')) return 'vp8';
  if (codec.startsWith('vp09')) return 'vp9';
  if (codec.startsWith('av01')) return 'av1';
  return 'avc';
}

function parseVideoCodec(codec: string): string {
  if (codec.startsWith('avc1')) return 'H.264 (AVC)';
  if (codec.startsWith('hev1') || codec.startsWith('hvc1')) return 'H.265 (HEVC)';
  if (codec.startsWith('vp09')) return 'VP9';
  if (codec.startsWith('av01')) return 'AV1';
  return codec;
}

function parseAudioCodec(codec: string): string {
  if (codec.startsWith('mp4a')) return 'AAC';
  if (codec.startsWith('opus')) return 'Opus';
  if (codec.startsWith('vorbis')) return 'Vorbis';
  return codec;
}

const api: any = {
  async extractMetadata(fileHandle: FileSystemFileHandle) {
    const file = await fileHandle.getFile();
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const source = new BlobSource(file);
    const input = new Input({ source, formats: ALL_FORMATS } as any);

    try {
      const durationS = await input.computeDuration();
      const vTrack = await input.getPrimaryVideoTrack();
      const aTrack = await input.getPrimaryAudioTrack();

      const meta: any = {
        source: {
          size: file.size,
          lastModified: file.lastModified,
        },
        duration: durationS,
      };

      if (vTrack) {
        const stats = await vTrack.computePacketStats(100);
        const codecParam = await vTrack.getCodecParameterString();
        const colorSpace =
          typeof vTrack.getColorSpace === 'function' ? await vTrack.getColorSpace() : undefined;

        meta.video = {
          width: vTrack.codedWidth,
          height: vTrack.codedHeight,
          displayWidth: vTrack.displayWidth,
          displayHeight: vTrack.displayHeight,
          rotation: vTrack.rotation,
          codec: codecParam || vTrack.codec || '',
          parsedCodec: parseVideoCodec(codecParam || vTrack.codec || ''),
          fps: stats.averagePacketRate,
          colorSpace,
        };
      }

      if (aTrack) {
        const codecParam = await aTrack.getCodecParameterString();
        meta.audio = {
          codec: codecParam || aTrack.codec || '',
          parsedCodec: parseAudioCodec(codecParam || aTrack.codec || ''),
          sampleRate: aTrack.sampleRate,
          channels: aTrack.numberOfChannels,
        };
      }

      return meta;
    } finally {
      if ('dispose' in input && typeof (input as any).dispose === 'function')
        (input as any).dispose();
      else if ('close' in input && typeof (input as any).close === 'function')
        (input as any).close();
    }
  },

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
    return compositor.loadTimeline(clips, async (path) => {
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
    await compositor.renderFrame(timeUs);
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

  async exportTimeline(targetHandle: FileSystemFileHandle, options: any, timelineClips: any[]) {
    cancelExportRequested = false;
    const {
      Output,
      Mp4OutputFormat,
      WebMOutputFormat,
      MkvOutputFormat,
      CanvasSource,
      AudioBufferSource,
      StreamTarget,
    } = await import('mediabunny');

    const localCompositor = new VideoCompositor();
    await localCompositor.init(options.width, options.height, '#000', true);

    try {
      const maxDurationUs = await localCompositor.loadTimeline(timelineClips, async (path) => {
        if (!hostClient) return null;
        return hostClient.getFileHandleByPath(path);
      });

      if (maxDurationUs <= 0) throw new Error('No video clips to export');

      const durationS = maxDurationUs / 1_000_000;
      let offlineCtx: OfflineAudioContext | null = null;
      let audioData: AudioBuffer | null = null;
      let hasAnyAudio = false;

      for (const c of localCompositor.clips) {
        if (c.input) {
          const audioTrack = await c.input.getPrimaryAudioTrack();
          if (audioTrack) {
            hasAnyAudio = true;
            break;
          }
        }
      }

      if (options.audio && hasAnyAudio) {
        offlineCtx = new OfflineAudioContext({
          numberOfChannels: 2,
          sampleRate: 48000,
          length: Math.ceil(48000 * durationS),
        });

        const decodedAudioCache = new Map<string, AudioBuffer | null>();

        for (const clipData of localCompositor.clips) {
          const sourceKey = clipData.sourcePath;
          let decoded = decodedAudioCache.get(sourceKey);

          if (typeof decoded === 'undefined') {
            try {
              const arrayBuffer = await clipData.fileHandle
                .getFile()
                .then((f: File) => f.arrayBuffer());
              decoded = await offlineCtx.decodeAudioData(arrayBuffer);
            } catch (err) {
              console.warn('[Worker Export] Failed to decode audio for clip', err);
              decoded = null;
            }
            decodedAudioCache.set(sourceKey, decoded);
          }

          if (!decoded) continue;

          const startAtS = Math.max(0, clipData.startUs / 1_000_000);
          const rawOffsetS = Math.max(0, clipData.sourceStartUs / 1_000_000);
          const offsetS = Math.min(rawOffsetS, decoded.duration);
          const sourceDurationS = Math.max(0, clipData.sourceDurationUs / 1_000_000);
          const timelineDurationS = Math.max(0, clipData.durationUs / 1_000_000);
          const clipDurationS = Math.max(
            0,
            Math.min(
              sourceDurationS || Number.POSITIVE_INFINITY,
              timelineDurationS || sourceDurationS,
            ),
          );
          const maxPlayableS = Math.max(0, decoded.duration - offsetS);
          const playDurationS = Math.min(clipDurationS || maxPlayableS, maxPlayableS);

          if (playDurationS <= 0) continue;

          const sourceNode = offlineCtx.createBufferSource();
          sourceNode.buffer = decoded;
          sourceNode.connect(offlineCtx.destination);
          sourceNode.start(startAtS, offsetS, playDurationS);
        }

        audioData = await offlineCtx.startRendering();
      }

      const format =
        options.format === 'webm'
          ? new WebMOutputFormat()
          : options.format === 'mkv'
            ? new MkvOutputFormat()
            : new Mp4OutputFormat();

      async function runExportWithHardwareAcceleration(
        preference: 'prefer-hardware' | 'prefer-software',
      ) {
        if (hostClient) {
          try {
            await (hostClient as any).onExportPhase?.('encoding');
          } catch {
            // ignore
          }
        }

        const writable = await (targetHandle as any).createWritable({ keepExistingData: false });

        const target = new StreamTarget(writable, {
          chunked: true,
          chunkSize: 16 * 1024 * 1024,
        });
        const output = new Output({ target, format });

        const videoSource = new CanvasSource(localCompositor.canvas as any, {
          codec: getBunnyVideoCodec(options.videoCodec),
          bitrate: options.bitrate,
          hardwareAcceleration: preference,
        });
        output.addVideoTrack(videoSource);

        let audioSource: any = null;
        if (audioData) {
          audioSource = new (AudioBufferSource as any)(audioData, {
            codec: options.audioCodec || 'aac',
            bitrate: options.audioBitrate,
            numberOfChannels: audioData.numberOfChannels,
            sampleRate: audioData.sampleRate,
          });
          output.addAudioTrack(audioSource);
        }

        const fps = Math.max(1, Math.round(Number(options.fps) || 30));
        const totalFrames = Math.ceil(durationS * fps);
        const dtUs = Math.floor(1_000_000 / fps);
        const dtS = dtUs / 1_000_000;
        let currentTimeUs = 0;

        let lastYieldAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

        try {
          await output.start();

          for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
            if (cancelExportRequested) {
              const abortErr = new Error('Export was cancelled');
              (abortErr as any).name = 'AbortError';
              throw abortErr;
            }
            const generatedCanvas = await localCompositor.renderFrame(currentTimeUs);
            if (generatedCanvas) {
              await (videoSource as any).add(currentTimeUs / 1_000_000, dtS);
            }
            currentTimeUs += dtUs;

            const progress = Math.min(100, Math.round(((frameNum + 1) / totalFrames) * 100));
            if (hostClient) await hostClient.onExportProgress(progress);

            const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (nowMs - lastYieldAtMs >= 50) {
              lastYieldAtMs = nowMs;
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
          }

          if ('close' in videoSource) (videoSource as any).close();
          if (audioSource && 'close' in audioSource) (audioSource as any).close();

          if (hostClient) {
            try {
              await (hostClient as any).onExportPhase?.('saving');
            } catch {
              // ignore
            }
          }

          await output.finalize();
          await writable.close();
        } catch (e) {
          try {
            if (typeof (writable as any).abort === 'function') {
              await (writable as any).abort();
            }
          } catch {
            // ignore
          }
          throw e;
        }
      }

      try {
        await runExportWithHardwareAcceleration('prefer-hardware');
      } catch (e) {
        console.warn(
          '[Worker Export] Hardware acceleration export failed, retrying with software',
          e,
        );
        await runExportWithHardwareAcceleration('prefer-software');
      }
    } finally {
      localCompositor.destroy();
    }
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
          const id = ++callIdCounter;
          pendingCalls.set(id, { resolve, reject });
          self.postMessage({ type: 'rpc-call', id, method, args });
        });
      };
    },
  },
) as VideoCoreHostAPI;
