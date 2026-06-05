import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ConversionRequest } from '~/types/conversion';
import type { TauriFileHandle } from '~/stores/workspace/provider/tauri-handle';
import { deserializeWaveformPeaks } from '~/utils/audio/waveform';

type NativeBytePayload = ArrayBuffer | ArrayBufferView | number[];

export interface NativeMediaMetadata {
  duration: number;
  video?: {
    width: number;
    height: number;
    fps: number;
    codec: string;
    bitrate?: number | null;
    rotation: number;
  } | null;
  audio?: {
    codec: string;
    bitrate?: number | null;
    sampleRate?: number | null;
    channels?: number | null;
  } | null;
}

export interface NativeProxyOptions {
  maxPixels: number;
  videoBitrateBps: number;
  audioBitrateBps: number;
  videoCodec: 'h264' | 'av1';
  copyOpusAudio: boolean;
}

export function getNativeFileHandlePath(handle: unknown): string | null {
  const path = (handle as Partial<TauriFileHandle> | null)?.path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

export async function nativeMediaMetadata(path: string): Promise<NativeMediaMetadata> {
  return await invoke<NativeMediaMetadata>('native_media_metadata', { path });
}

/**
 * Extracts per-channel waveform peaks natively.
 *
 * NOTE: `precision` exists only for parity with the web-worker extractor, which
 * uses it to quantize peaks before JSON serialization. The native path returns a
 * compact binary f32 payload, so it keeps full precision and ignores this value;
 * it is still forwarded so the IPC signature stays stable across runtimes.
 */
export async function nativeMediaExtractPeaks(
  path: string,
  maxLength: number,
  precision?: number,
): Promise<Float32Array[]> {
  const bytes = await invoke<NativeBytePayload>('native_media_extract_peaks', {
    path,
    maxLength,
    precision: precision ?? 0,
  });
  const peaks = deserializeWaveformPeaks(toBlobPart(bytes));
  if (!peaks) {
    throw new Error('Invalid native waveform payload');
  }
  return peaks;
}

export async function nativeGenerateProxy(params: {
  taskId: string;
  sourcePath: string;
  targetPath: string;
  options: NativeProxyOptions;
}): Promise<void> {
  await invoke('native_media_generate_proxy', {
    taskId: params.taskId,
    sourcePath: params.sourcePath,
    targetPath: params.targetPath,
    options: {
      maxPixels: params.options.maxPixels,
      videoBitrateBps: params.options.videoBitrateBps,
      audioBitrateBps: params.options.audioBitrateBps,
      videoCodec: params.options.videoCodec,
      copyOpusAudio: params.options.copyOpusAudio,
    },
  });
}

export async function nativeConvertMedia(params: {
  taskId: string;
  sourcePath: string;
  targetPath: string;
  request: ConversionRequest;
}): Promise<void> {
  await invoke('native_media_convert', {
    taskId: params.taskId,
    sourcePath: params.sourcePath,
    targetPath: params.targetPath,
    options: buildNativeConvertOptions(params.request),
  });
}

export async function nativeCancelMediaTask(taskId: string): Promise<boolean> {
  return await invoke<boolean>('native_media_cancel', { taskId });
}

export interface NativeTimelineExportOptions {
  width: number;
  height: number;
  fps: number;
  startSec: number;
  endSec: number;
  videoCodec: string;
  videoBitrateBps: number;
  format: string;
  audioEnabled?: boolean;
  audioPath?: string | null;
  audioCodec?: string | null;
  audioBitrateBps?: number | null;
  exportAlpha?: boolean;
}

export async function nativeExportTimeline(params: {
  taskId: string;
  scene: unknown;
  targetPath: string;
  options: NativeTimelineExportOptions;
  onProgress?: (progress: number) => void;
}): Promise<void> {
  const unlisten = params.onProgress
    ? await listen<{ taskId: string; progress: number }>(
        'native-timeline-export:progress',
        (event) => {
          if (event.payload.taskId !== params.taskId) return;
          params.onProgress?.(event.payload.progress);
        },
      )
    : null;

  try {
    await invoke('native_timeline_export', {
      taskId: params.taskId,
      scene: params.scene,
      targetPath: params.targetPath,
      options: params.options,
    });
  } finally {
    unlisten?.();
  }
}

export async function nativeRenderTimelineFrameWebp(params: {
  scene: unknown;
  timeSec: number;
  width: number;
  height: number;
  quality: number;
}): Promise<Blob> {
  const bytes = await invoke<NativeBytePayload>('native_timeline_render_frame_webp', {
    scene: params.scene,
    timeSec: params.timeSec,
    width: params.width,
    height: params.height,
    quality: params.quality,
  });
  return new Blob([toBlobPart(bytes)], { type: 'image/webp' });
}

export async function nativeVideoFrameWebp(params: {
  sourcePath: string;
  timeSec: number;
  maxWidth: number;
  maxHeight: number;
  quality: number;
}): Promise<Blob> {
  const bytes = await invoke<NativeBytePayload>('native_video_frame_webp', {
    sourcePath: params.sourcePath,
    timeSec: params.timeSec,
    maxWidth: params.maxWidth,
    maxHeight: params.maxHeight,
    quality: params.quality,
  });
  return new Blob([toBlobPart(bytes)], { type: 'image/webp' });
}

export async function nativeVideoFrameWebps(params: {
  sourcePath: string;
  timesSec: number[];
  maxWidth: number;
  maxHeight: number;
  quality: number;
}): Promise<(Blob | null)[]> {
  const packedBytes = toUint8Array(
    await invoke<NativeBytePayload>('native_video_frame_webps', {
      sourcePath: params.sourcePath,
      timesSec: params.timesSec,
      maxWidth: params.maxWidth,
      maxHeight: params.maxHeight,
      quality: params.quality,
    }),
  );

  const view = new DataView(packedBytes.buffer, packedBytes.byteOffset, packedBytes.byteLength);
  const count = view.getUint32(0, true);
  const sizes: number[] = [];
  let offset = 4;
  for (let i = 0; i < count; i++) {
    sizes.push(view.getUint32(offset, true));
    offset += 4;
  }

  const blobs: (Blob | null)[] = [];
  for (const size of sizes) {
    if (size === 0) {
      blobs.push(null);
    } else {
      const slice = packedBytes.subarray(offset, offset + size);
      blobs.push(new Blob([toBlobPart(slice)], { type: 'image/webp' }));
      offset += size;
    }
  }

  return blobs;
}

function toUint8Array(bytes: NativeBytePayload): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  throw new TypeError('Expected native byte payload');
}

function toBlobPart(bytes: NativeBytePayload): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  const view = toUint8Array(bytes);
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer;
  }
  return view.slice().buffer as ArrayBuffer;
}

export const __tauriMediaProcessingTestHooks = {
  toBlobPart,
  toUint8Array,
};

function buildNativeConvertOptions(request: ConversionRequest) {
  if (request.type === 'video' && request.video) {
    return {
      kind: 'video',
      format: request.video.format,
      videoCodec: request.video.videoCodec,
      videoBitrateBps: request.video.bitrateMbps * 1_000_000,
      audioCodec: request.video.format === 'mp4' ? 'aac' : request.video.audioCodec,
      audioBitrateBps: request.video.audioBitrateKbps * 1000,
      audio: !request.video.excludeAudio,
      width: request.video.width,
      height: request.video.height,
      fps: request.video.fps,
      audioChannels: request.sharedAudio.channels,
      audioSampleRate: request.sharedAudio.sampleRate,
      audioReverse: false,
    };
  }

  if (request.type === 'audio' && request.audioOnly) {
    let nativeFormat = 'opus';
    if (request.audioOnly.codec === 'aac') nativeFormat = 'm4a';
    else if (request.audioOnly.codec === 'flac') nativeFormat = 'flac';
    else if (request.audioOnly.codec === 'pcm') nativeFormat = 'wav';
    else if (request.audioOnly.codec === 'mp3') nativeFormat = 'mp3';
    return {
      kind: 'audio',
      format: nativeFormat,
      audioCodec: request.audioOnly.codec,
      audioBitrateBps: request.audioOnly.bitrateKbps * 1000,
      audio: true,
      audioChannels: request.sharedAudio.channels,
      audioSampleRate: request.sharedAudio.sampleRate,
      audioReverse: request.audioOnly.reverse,
    };
  }

  throw new Error(`Unsupported native conversion request type: ${request.type}`);
}
