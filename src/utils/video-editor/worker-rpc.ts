import type { WorkerTimelineClip } from '../../composables/monitor/types';

export interface PreviewRenderOptions {
  previewEffectsEnabled?: boolean;
  videoFrameCacheMb?: number;
}

export interface VideoCoreWorkerAPI {
  // Metadata
  extractMetadata(file: File | FileSystemFileHandle): Promise<any>;

  // initCompositor is implemented manually in the client proxy
  initCompositor(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    bgColor: string,
  ): Promise<void>;
  loadTimeline(
    clips: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[],
  ): Promise<number>;
  updateTimelineLayout(
    clips: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[],
  ): Promise<number>;
  renderFrame(
    timeUs: number,
    options?: PreviewRenderOptions,
  ): Promise<OffscreenCanvas | HTMLCanvasElement | null>;
  clearClips(): Promise<void>;
  destroyCompositor(): Promise<void>;

  // Export
  exportTimeline(
    targetHandle: FileSystemFileHandle,
    options: any,
    timelineClips: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[],
    audioClips?: any[],
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
    timelineClips: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[],
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

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  videoCodec: string;
  format: 'mp4' | 'webm' | 'mkv';
  exportAlpha?: boolean;
  bitrateMode?: 'constant' | 'variable';
  keyframeIntervalSec?: number;
  audio?: boolean;
  audioPassthrough?: boolean;
  audioSampleRate?: number;
  audioChannels?: 'mono' | 'stereo';
  audioCodec?: string;
  audioBitrate?: number;
}
