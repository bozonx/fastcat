import type {
  WorkerTimelineClip,
  ExportOptions,
  TranscodeOptions,
  WorkerVideoPayloadItem,
} from '~/composables/timeline/export/types';
import type { MediaMetadata } from '~/stores/media.store';
import type { VideoCoreHostAPI } from './worker-client';
import { z } from 'zod';

export interface PreviewRenderOptions {
  previewEffectsEnabled?: boolean;
  pixiRenderer?: 'webgl' | 'webgpu';
  videoFrameCacheMb?: number;
  monitorSyncMode?: 'smooth' | 'balanced' | 'strict';
}

export interface WorkerRpcErrorShape {
  name: string;
  message: string;
  cause?: unknown;
  stack?: string;
}

export const PreviewRenderOptionsSchema = z.object({
  previewEffectsEnabled: z.boolean().optional(),
  pixiRenderer: z.enum(['webgl', 'webgpu']).optional(),
  videoFrameCacheMb: z.number().finite().nonnegative().optional(),
  monitorSyncMode: z.enum(['smooth', 'balanced', 'strict']).optional(),
});

const VideoColorSpaceSchema = z.object({
  fullRange: z.boolean().optional(),
  matrix: z.string().optional(),
  primaries: z.string().optional(),
  transfer: z.string().optional(),
});

export const MediaMetadataSchema = z.object({
  source: z.object({
    size: z.number().finite().nonnegative(),
    lastModified: z.number().finite().nonnegative(),
  }),
  mimeType: z.string().optional(),
  container: z.string().optional(),
  duration: z.number().finite().nonnegative(),
  video: z
    .object({
      width: z.number().finite().nonnegative(),
      height: z.number().finite().nonnegative(),
      displayWidth: z.number().finite().nonnegative(),
      displayHeight: z.number().finite().nonnegative(),
      rotation: z.number().finite(),
      codec: z.string(),
      parsedCodec: z.string(),
      fps: z.number().finite().nonnegative(),
      bitrate: z.number().finite().nonnegative().optional(),
      colorSpace: VideoColorSpaceSchema.optional(),
    })
    .optional(),
  audio: z
    .object({
      codec: z.string(),
      parsedCodec: z.string(),
      sampleRate: z.number().finite().positive(),
      channels: z.number().int().positive(),
      bitrate: z.number().finite().nonnegative().optional(),
    })
    .optional(),
  image: z
    .object({
      canDisplay: z.boolean().optional(),
      width: z.number().finite().nonnegative().optional(),
      height: z.number().finite().nonnegative().optional(),
    })
    .optional(),
  error: z.boolean().optional(),
  // audioPeaks are persisted to a separate OPFS file and converted to
  // Float32Array on read (see media.store.ts). They never travel through
  // this schema, so we don't validate them here.
});

export function parseMediaMetadata(value: unknown): MediaMetadata {
  return MediaMetadataSchema.parse(value);
}

export function safeParseMediaMetadata(value: unknown) {
  return MediaMetadataSchema.safeParse(value);
}

type RpcMethod<Args extends unknown[] = unknown[], Result = unknown> = (
  ...args: Args
) => Promise<Result>;

type RpcMethodKeys<T> = {
  [K in keyof T]: T[K] extends RpcMethod ? K : never;
}[keyof T] &
  string;

type RpcArgs<T, K extends RpcMethodKeys<T>> =
  T[K] extends RpcMethod<infer Args, unknown> ? Args : never;

type RpcResult<T, K extends RpcMethodKeys<T>> =
  T[K] extends RpcMethod<unknown[], infer Result> ? Result : never;

export type RpcCallMessageForApi<T> = {
  [K in RpcMethodKeys<T>]: {
    type: 'rpc-call';
    id: number;
    method: K;
    args: RpcArgs<T, K>;
    taskId?: string;
  };
}[RpcMethodKeys<T>];

export type RpcResponseMessageForApi<T> = {
  [K in RpcMethodKeys<T>]: {
    type: 'rpc-response';
    id: number;
    method?: K;
    result?: RpcResult<T, K>;
    error?: WorkerRpcErrorShape;
  };
}[RpcMethodKeys<T>];

export type RpcMessageForApi<T> = RpcCallMessageForApi<T> | RpcResponseMessageForApi<T>;

export type VideoCoreWorkerRpcMessage = RpcMessageForApi<VideoCoreWorkerAPI>;

export type VideoCoreHostRpcMessage = RpcMessageForApi<VideoCoreHostAPI>;

export interface VideoCoreWorkerAPI {
  // Metadata
  extractMetadata(file: File | FileSystemFileHandle): Promise<MediaMetadata>;

  setPixiRendererPreference(preference: 'webgl' | 'webgpu'): Promise<void>;

  checkWebGpuSupport(): Promise<{ supported: boolean; error: string | null }>;

  // initCompositor is implemented manually in the client proxy
  initCompositor(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    bgColor: string,
    rendererPreference?: 'webgl' | 'webgpu',
  ): Promise<void>;
  /**
   * Full rebuild of the compositor timeline. Cancels any in-flight load and
   * re-creates clip sprites, textures, and media decoders from scratch.
   * Use this when the clip set itself changes (add/remove/reorder clips).
   */
  loadTimeline(clips: WorkerVideoPayloadItem[], requestId?: number): Promise<number>;
  /**
   * Incremental layout update. Mutates existing clip positions, durations, and
   * effects without destroying and re-creating sprites or media decoders.
   * Use this when only clip properties (trim, position, opacity, etc.) change.
   */
  updateTimelineLayout(clips: WorkerVideoPayloadItem[]): Promise<number>;
  renderFrame(
    timeUs: number,
    options?: PreviewRenderOptions,
  ): Promise<OffscreenCanvas | HTMLCanvasElement | null>;
  clearClips(): Promise<void>;
  destroyCompositor(): Promise<void>;

  // Export
  exportTimeline(
    targetHandle: FileSystemFileHandle,
    options: ExportOptions,
    videoPayload: WorkerVideoPayloadItem[],
    audioClips: WorkerTimelineClip[],
    taskId?: string,
    masterAudioEffects?: import('../audio/apply-audio-effects-offline').AudioEffectData[],
  ): Promise<void>;

  transcodeMedia(
    sourceFile: File | FileSystemFileHandle,
    targetHandle: FileSystemFileHandle,
    options: TranscodeOptions,
    taskId?: string,
  ): Promise<void>;

  cancelExport(taskId?: string): Promise<void>;

  extractFrameToBlob(
    timeUs: number,
    width: number,
    height: number,
    timelineClips: WorkerVideoPayloadItem[],
    quality: number,
  ): Promise<Blob | null>;

  extractAudio(sourcePath: string, targetPath: string, taskId?: string): Promise<void>;

  extractVideoFrameBlobs(
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
  ): Promise<(Blob | null)[]>;

  releaseFrameExtractor(taskId: string): Promise<void>;
}

export type WorkerRpcMessage = VideoCoreWorkerRpcMessage | VideoCoreHostRpcMessage;
