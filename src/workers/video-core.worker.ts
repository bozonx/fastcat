import './worker-polyfill';

import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

import type { VideoCoreHostAPI } from '../utils/video-editor/worker-client';
import type { VideoCoreWorkerAPI } from '../utils/video-editor/worker-rpc';
import { VideoCompositor } from '../utils/video-editor/VideoCompositor';
DOMAdapter.set(WebWorkerAdapter);

let hostClient: VideoCoreHostAPI | null = null;
let compositor: VideoCompositor | null = null;

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

        for (const clipData of localCompositor.clips) {
          const arrayBuffer = await clipData.fileHandle
            .getFile()
            .then((f: File) => f.arrayBuffer());
          try {
            const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
            const sourceNode = offlineCtx.createBufferSource();
            sourceNode.buffer = audioBuffer;
            sourceNode.connect(offlineCtx.destination);
            sourceNode.start(clipData.startUs / 1_000_000);
          } catch (err) {
            console.warn('[Worker Export] Failed to decode audio for clip', err);
          }
        }

        audioData = await offlineCtx.startRendering();
      }

      let format;
      if (options.format === 'webm') format = new WebMOutputFormat();
      else if (options.format === 'mkv') format = new MkvOutputFormat();
      else format = new Mp4OutputFormat();

      const writable = await (targetHandle as any).createWritable();
      const target = new StreamTarget(writable, {
        chunked: true,
        chunkSize: 16 * 1024 * 1024,
      });
      const output = new Output({ target, format });

      const videoSource = new CanvasSource(localCompositor.canvas as any, {
        codec: getBunnyVideoCodec(options.videoCodec),
        bitrate: options.bitrate,
        hardwareAcceleration: 'prefer-software',
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

      const totalFrames = Math.ceil(durationS * options.fps);
      const dtUs = Math.floor(1_000_000 / options.fps);
      let currentTimeUs = 0;

      await output.start();

      for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
        const generatedCanvas = await localCompositor.renderFrame(currentTimeUs);
        if (generatedCanvas) {
          await (videoSource as any).add(currentTimeUs / 1_000_000);
        }
        currentTimeUs += dtUs;

        const progress = Math.min(100, Math.round(((frameNum + 1) / totalFrames) * 100));
        if (hostClient) hostClient.onExportProgress(progress);

        if ((frameNum + 1) % 12 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      if ('close' in videoSource) (videoSource as any).close();
      if (audioSource && 'close' in audioSource) (audioSource as any).close();

      await output.finalize();
    } finally {
      localCompositor.destroy();
    }
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
      if (data.error) pending.reject(new Error(data.error));
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
      self.postMessage({ type: 'rpc-response', id: data.id, error: err.message });
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
