import type {
  WorkerTimelineClip,
  ExportOptions,
  WorkerVideoPayloadItem,
} from '~/composables/timeline/export/types';
import type { MediaMetadata } from '~/stores/media.store';
import type { VideoCoreHostAPI } from './worker-client';
import { z } from 'zod';

export interface PreviewRenderOptions {
  previewEffectsEnabled?: boolean;
  videoFrameCacheMb?: number;
}

export interface WorkerRpcErrorShape {
  name: string;
  message: string;
  cause?: unknown;
  stack?: string;
}

export const PreviewRenderOptionsSchema = z.object({
  previewEffectsEnabled: z.boolean().optional(),
  videoFrameCacheMb: z.number().finite().nonnegative().optional(),
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
  audioPeaks: z.array(z.array(z.number().finite())).optional(),
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

  // initCompositor is implemented manually in the client proxy
  initCompositor(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    bgColor: string,
  ): Promise<void>;
  loadTimeline(clips: WorkerVideoPayloadItem[]): Promise<number>;
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
  ): Promise<void>;

  transcodeMedia(
    sourceFile: File | FileSystemFileHandle,
    targetHandle: FileSystemFileHandle,
    options: ExportOptions,
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
    },
  ): Promise<(Blob | null)[]>;
}

export type WorkerRpcMessage = VideoCoreWorkerRpcMessage | VideoCoreHostRpcMessage;
