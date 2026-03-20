import type {
  WorkerTimelineClip,
  ExportOptions,
  WorkerVideoPayloadItem,
} from '~/composables/timeline/export/types';
import type { MediaMetadata } from '~/stores/media.store';

export interface PreviewRenderOptions {
  previewEffectsEnabled?: boolean;
  videoFrameCacheMb?: number;
}

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
