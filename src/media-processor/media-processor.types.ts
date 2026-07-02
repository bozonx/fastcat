import type { TimelineDocument } from '~/timeline/types';

export interface ExtractVideoFrameBlobOptions {
  projectRelativePath: string;
  /** Absolute timestamp in seconds. Has priority over `positionFraction` when both are set. */
  timeSec?: number;
  /** Position as a 0..1 fraction of the source duration. Native path uses it to avoid an extra probe round-trip. */
  positionFraction?: number;
  maxWidth: number;
  maxHeight: number;
  quality: number;
}

export interface ExtractVideoFrameBlobsOptions {
  projectRelativePath: string;
  timesSec: number[];
  maxWidth: number;
  maxHeight: number;
  quality: number;
  mimeType?: string;
  taskId?: string;
  keepAlive?: boolean;
}

export interface ExtractTimelineFrameBlobOptions {
  timelineDoc: TimelineDocument;
  timeUs: number;
  /** Exact output dimensions. If omitted, the frame is fitted into `maxWidth` / `maxHeight`. */
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  /** Native-only: build the scene at export (ultra) quality so stills match export output. */
  isExport?: boolean;
  /** Whether to render background as transparent (true) or opaque black (false). */
  isTransparent?: boolean;
}

export interface IMediaProcessor {
  id: 'native' | 'web';

  extractVideoFrameBlob(options: ExtractVideoFrameBlobOptions): Promise<Blob | null>;

  extractVideoFrameBlobs(options: ExtractVideoFrameBlobsOptions): Promise<(Blob | null)[]>;

  extractTimelineFrameBlob(options: ExtractTimelineFrameBlobOptions): Promise<Blob | null>;

  cancelVideoFrameExtraction(taskId: string): Promise<void>;

  releaseVideoFrameExtractor(taskId: string): Promise<void>;

  dispose(): Promise<void>;
}
