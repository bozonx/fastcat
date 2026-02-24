import './worker-polyfill';

import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

import type { VideoCoreHostAPI } from '../utils/video-editor/worker-client';
import type { VideoCoreWorkerAPI } from '../utils/video-editor/worker-rpc';
import { VideoCompositor } from '../utils/video-editor/VideoCompositor';
DOMAdapter.set(WebWorkerAdapter);

let hostClient: VideoCoreHostAPI | null = null;
let compositor: VideoCompositor | null = null;
let cancelExportRequested = false;

async function reportExportWarning(message: string) {
  console.warn(message);
  if (!hostClient) return;
  try {
    await (hostClient as any).onExportWarning?.(message);
  } catch {
    // ignore
  }
}

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

function getBunnyAudioCodec(codec: string | undefined): any {
  if (!codec) return 'aac';
  const v = String(codec).toLowerCase();
  if (v === 'aac' || v.startsWith('mp4a')) return 'aac';
  if (v === 'opus') return 'opus';
  return codec;
}

function clampFloat32(v: number) {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

async function buildMixedAudioTrack(options: any, audioClips: any[], durationS: number) {
  const { AudioSample, AudioSampleSink, AudioSampleSource, Input, BlobSource, ALL_FORMATS } =
    await import('mediabunny');

  const sampleRate = 48000;
  const numberOfChannels = 2;

  const chunkDurationS = 1;
  const chunkFrames = sampleRate * chunkDurationS;

  const chunks = new Map<number, Float32Array>();

  async function getOrCreateChunk(index: number) {
    const existing = chunks.get(index);
    if (existing) return existing;
    const buf = new Float32Array(chunkFrames * numberOfChannels);
    chunks.set(index, buf);
    return buf;
  }

  const MAX_AUDIO_FILE_BYTES = 200 * 1024 * 1024;

  for (const clipData of audioClips) {
    const sourcePath = clipData.sourcePath || clipData.source?.path;
    if (!sourcePath) continue;

    let fileHandle: FileSystemFileHandle | null = clipData.fileHandle || null;
    if (!fileHandle && hostClient) {
      fileHandle = await hostClient.getFileHandleByPath(sourcePath);
    }
    if (!fileHandle) continue;

    let file: File;
    try {
      file = await fileHandle.getFile();
    } catch {
      await reportExportWarning('[Worker Export] Failed to read audio file handle');
      continue;
    }

    if (file.size > MAX_AUDIO_FILE_BYTES) {
      await reportExportWarning(
        '[Worker Export] Audio file is too large to decode in memory; skipping audio clip.',
      );
      continue;
    }

    const startUs = clipData.startUs ?? clipData.timelineRange?.startUs ?? 0;
    const sourceStartUs = clipData.sourceStartUs ?? clipData.sourceRange?.startUs ?? 0;
    const sourceDurationUs = clipData.sourceDurationUs ?? clipData.sourceRange?.durationUs ?? 0;
    const durationUs = clipData.durationUs ?? clipData.timelineRange?.durationUs ?? 0;

    const clipStartS = Math.max(0, startUs / 1_000_000);
    const rawOffsetS = Math.max(0, sourceStartUs / 1_000_000);
    const sourceDurationS = Math.max(0, sourceDurationUs / 1_000_000);
    const timelineDurationS = Math.max(0, durationUs / 1_000_000);
    const clipDurationS = Math.max(
      0,
      Math.min(sourceDurationS || Number.POSITIVE_INFINITY, timelineDurationS || sourceDurationS),
    );

    if (clipDurationS <= 0) continue;

    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS } as any);
    try {
      const aTrack = await input.getPrimaryAudioTrack();
      if (!aTrack) continue;
      if (!(await aTrack.canDecode())) continue;

      const sink = new AudioSampleSink(aTrack);
      try {
        const offsetS = Math.max(0, rawOffsetS);
        const trackDurationS = (aTrack as any).duration;
        const maxPlayableS = Math.max(
          0,
          (Number.isFinite(trackDurationS) ? Number(trackDurationS) : Number.POSITIVE_INFINITY) -
            offsetS,
        );
        const playDurationS = Math.min(clipDurationS, maxPlayableS);
        if (playDurationS <= 0) continue;

        for await (const sampleRaw of (sink as any).samples(offsetS, offsetS + playDurationS)) {
          const sample = sampleRaw as any;
          try {
            const frames = Number(sample.numberOfFrames) || 0;
            const sr = Number(sample.sampleRate) || 0;
            const ch = Number(sample.numberOfChannels) || 0;

            if (frames <= 0) continue;
            if (sr !== sampleRate || ch !== numberOfChannels) {
              await reportExportWarning(
                '[Worker Export] Audio clip sample format mismatch; skipping some audio.',
              );
              continue;
            }

            const localTimeS = Number(sample.timestamp) - offsetS;
            const timelineTimeS = clipStartS + localTimeS;
            if (!Number.isFinite(timelineTimeS)) continue;
            if (timelineTimeS < 0 || timelineTimeS > durationS) continue;

            const startFrameGlobal = Math.floor(timelineTimeS * sampleRate);
            const endFrameGlobal = startFrameGlobal + frames;
            if (endFrameGlobal <= 0) continue;

            const tmpPlanes: Float32Array[] = [];
            for (let planeIndex = 0; planeIndex < numberOfChannels; planeIndex += 1) {
              const bytesNeeded = sample.allocationSize({
                format: 'f32-planar',
                planeIndex,
              });
              const plane = new Float32Array(bytesNeeded / 4);
              sample.copyTo(plane, { format: 'f32-planar', planeIndex });
              tmpPlanes.push(plane);
            }

            for (let i = 0; i < frames; i += 1) {
              const globalFrame = startFrameGlobal + i;
              if (globalFrame < 0) continue;
              if (globalFrame >= Math.floor(durationS * sampleRate)) break;

              const chunkIndex = Math.floor(globalFrame / chunkFrames);
              const chunk = await getOrCreateChunk(chunkIndex);
              const frameInChunk = globalFrame - chunkIndex * chunkFrames;
              if (frameInChunk < 0 || frameInChunk >= chunkFrames) continue;

              for (let c = 0; c < numberOfChannels; c += 1) {
                const plane = tmpPlanes[c];
                const v = plane ? (plane[i] ?? 0) : 0;
                const idx = frameInChunk * numberOfChannels + c;
                chunk[idx] = clampFloat32(chunk[idx] + v);
              }
            }
          } finally {
            if (typeof sample.close === 'function') sample.close();
          }
        }
      } finally {
        if (typeof (sink as any).close === 'function') (sink as any).close();
        if (typeof (sink as any).dispose === 'function') (sink as any).dispose();
      }
    } catch {
      await reportExportWarning('[Worker Export] Failed to decode audio clip');
    } finally {
      if ('dispose' in input && typeof (input as any).dispose === 'function')
        (input as any).dispose();
      else if ('close' in input && typeof (input as any).close === 'function')
        (input as any).close();
    }
  }

  if (chunks.size === 0) return null;

  const audioSource = new AudioSampleSource({
    codec: getBunnyAudioCodec(options.audioCodec),
    bitrate: options.audioBitrate,
  });

  const samples: Array<{ data: Float32Array; timestamp: number }> = [];
  const totalFrames = Math.ceil(durationS * sampleRate);
  const totalChunks = Math.max(1, Math.ceil(totalFrames / chunkFrames));
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const chunk = chunks.get(chunkIndex) ?? new Float32Array(chunkFrames * numberOfChannels);
    const framesInChunk = Math.min(chunkFrames, totalFrames - chunkIndex * chunkFrames);
    if (framesInChunk <= 0) continue;

    const plane0 = new Float32Array(framesInChunk);
    const plane1 = new Float32Array(framesInChunk);
    for (let i = 0; i < framesInChunk; i += 1) {
      plane0[i] = chunk[i * 2] ?? 0;
      plane1[i] = chunk[i * 2 + 1] ?? 0;
    }

    const planar = new Float32Array(framesInChunk * 2);
    planar.set(plane0, 0);
    planar.set(plane1, framesInChunk);

    const timestamp = chunkIndex * chunkDurationS;
    samples.push({ data: planar, timestamp });
  }

  return {
    audioSource,
    samples,
    numberOfChannels,
    sampleRate,
  };
}

const api: any = {
  async extractMetadata(fileHandle: FileSystemFileHandle) {
    const file = await fileHandle.getFile();

    if (typeof file?.type === 'string' && file.type.startsWith('image/')) {
      return {
        source: {
          size: file.size,
          lastModified: file.lastModified,
        },
        duration: 0,
      };
    }

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

  async exportTimeline(
    targetHandle: FileSystemFileHandle,
    options: any,
    timelineClips: any[],
    audioClips: any[] = [],
  ) {
    cancelExportRequested = false;
    const {
      Output,
      Mp4OutputFormat,
      WebMOutputFormat,
      MkvOutputFormat,
      CanvasSource,
      StreamTarget,
    } = await import('mediabunny');

    const localCompositor = new VideoCompositor();
    await localCompositor.init(options.width, options.height, '#000', true);

    try {
      const maxVideoDurationUs = await localCompositor.loadTimeline(timelineClips, async (path) => {
        if (!hostClient) return null;
        return hostClient.getFileHandleByPath(path);
      });

      const maxAudioDurationUs = audioClips.reduce((max, clip) => {
        const endUs =
          Number(clip.timelineRange?.startUs || 0) + Number(clip.timelineRange?.durationUs || 0);
        return Math.max(max, endUs);
      }, 0);

      const maxDurationUs = Math.max(maxVideoDurationUs, maxAudioDurationUs);

      if (maxDurationUs <= 0) throw new Error('No clips to export');

      const durationS = maxDurationUs / 1_000_000;
      const hasAnyAudio = audioClips.length > 0;

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
        let audioSamples: Array<{ data: Float32Array; timestamp: number }> | null = null;
        let audioSampleRate = 48000;
        let audioNumberOfChannels = 2;
        if (options.audio && hasAnyAudio) {
          const audioTrack = await buildMixedAudioTrack(options, audioClips, durationS);
          if (audioTrack) {
            audioSource = audioTrack.audioSource;
            audioSamples = audioTrack.samples;
            audioSampleRate = audioTrack.sampleRate;
            audioNumberOfChannels = audioTrack.numberOfChannels;
            output.addAudioTrack(audioSource);
          } else {
            await reportExportWarning(
              '[Worker Export] No decodable audio track found; exporting without audio.',
            );
          }
        }

        const fps = Math.max(1, Math.round(Number(options.fps) || 30));
        const totalFrames = Math.ceil(durationS * fps);
        const dtUs = Math.floor(1_000_000 / fps);
        const dtS = dtUs / 1_000_000;
        let currentTimeUs = 0;

        let lastYieldAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let lastProgressAtMs = lastYieldAtMs;
        const yieldIntervalMs = 16;
        const progressIntervalMs = 250;

        try {
          await output.start();

          if (audioSource && audioSamples) {
            const { AudioSample } = await import('mediabunny');
            for (const sampleInfo of audioSamples) {
              const sample = new AudioSample({
                data: sampleInfo.data,
                format: 'f32-planar',
                numberOfChannels: audioNumberOfChannels,
                sampleRate: audioSampleRate,
                timestamp: sampleInfo.timestamp,
              });
              try {
                await audioSource.add(sample);
              } finally {
                if (typeof sample.close === 'function') sample.close();
              }
            }
          }

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
            const nowProgressMs =
              typeof performance !== 'undefined' ? performance.now() : Date.now();
            const shouldReport =
              frameNum + 1 === totalFrames ||
              nowProgressMs - lastProgressAtMs >= progressIntervalMs;
            if (hostClient && shouldReport) {
              lastProgressAtMs = nowProgressMs;
              await hostClient.onExportProgress(progress);
            }

            const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (nowMs - lastYieldAtMs >= yieldIntervalMs) {
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
        } catch (e) {
          try {
            // mediabunny automatically closes the stream on finalize/cancel.
            // Ensure we call cancel() on failure to release any stream locks.
            if (typeof (output as any).cancel === 'function') {
              await (output as any).cancel();
            }
          } catch {
            // ignore
          }

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
