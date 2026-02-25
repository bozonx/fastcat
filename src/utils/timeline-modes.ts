/** Clip overlap mode on the timeline */
export type OverlapMode =
  /** Default: clips cannot overlap, placed sequentially */
  | 'none'
  /** Pseudo-overlay: dragged clip cuts/trims underlying clips */
  | 'pseudo';

/** Snap-to-frames mode */
export type FrameSnapMode =
  /** Free placement — no frame grid snapping */
  | 'free'
  /** Snap positions and trim handles to frame grid */
  | 'frames';

/** Snap-to-clips mode */
export type ClipSnapMode =
  /** No clip snapping */
  | 'none'
  /** Clips snap to each other and to timeline start */
  | 'clips';

export interface TimelineSnapSettings {
  overlapMode: OverlapMode;
  frameSnapMode: FrameSnapMode;
  clipSnapMode: ClipSnapMode;
  /** Snap threshold in pixels */
  snapThresholdPx: number;
}

export const DEFAULT_SNAP_SETTINGS: TimelineSnapSettings = {
  overlapMode: 'none',
  frameSnapMode: 'frames',
  clipSnapMode: 'clips',
  snapThresholdPx: 8,
};
