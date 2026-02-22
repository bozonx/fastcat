import { createChannel } from 'bidc';

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
  renderFrame(timeUs: number): Promise<void>;
  clearClips(): Promise<void>;
  destroyCompositor(): Promise<void>;

  // Export
  exportTimeline(
    targetHandle: FileSystemFileHandle,
    options: any,
    timelineClips: any[],
  ): Promise<void>;

  cancelExport(): Promise<void>;
}

export type WorkerCallbacks = {
  // Functions the worker can call on the main thread
  onExportProgress: (progress: number) => void;
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
};
