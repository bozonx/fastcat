import { createChannel } from 'bidc';

export interface PreviewRenderOptions {
  previewEffectsEnabled?: boolean;
}

export interface VideoCoreWorkerAPI {
  // Metadata
  extractMetadata(fileHandle: FileSystemFileHandle): Promise<any>;

  // initCompositor is implemented manually in the client proxy
  initCompositor(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    bgColor: string,
  ): Promise<void>;
  loadTimeline(clips: any[]): Promise<number>;
  updateTimelineLayout(clips: any[]): Promise<number>;
  renderFrame(timeUs: number, options?: PreviewRenderOptions): Promise<void>;
  clearClips(): Promise<void>;
  destroyCompositor(): Promise<void>;

  // Export
  exportTimeline(
    targetHandle: FileSystemFileHandle,
    options: any,
    timelineClips: any[],
    audioClips?: any[],
  ): Promise<void>;

  cancelExport(): Promise<void>;

  extractFrameToBlob(
    timeUs: number,
    width: number,
    height: number,
    timelineClips: any[],
    quality: number,
  ): Promise<Blob | null>;
}

export type WorkerCallbacks = {
  // Functions the worker can call on the main thread
  onExportProgress: (progress: number) => void;
  onExportPhase?: (phase: 'encoding' | 'saving') => void;
  getCurrentProjectId: () => Promise<string | null>;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  ensureVectorImageRaster: (params: {
    projectId: string;
    projectRelativePath: string;
    width: number;
    height: number;
    sourceFileHandle: FileSystemFileHandle;
  }) => Promise<FileSystemFileHandle | null>;
};
