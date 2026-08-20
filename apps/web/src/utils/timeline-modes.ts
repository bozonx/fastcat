/** Snap-to-frames mode */
export type FrameSnapMode =
  /** Free placement — no frame grid snapping */
  | 'free'
  /** Snap positions and trim handles to frame grid */
  | 'frames';

export interface TimelineSnapSettings {
  frameSnapMode: FrameSnapMode;
  /** Snap threshold in pixels */
  snapThresholdPx: number;
}

export const DEFAULT_SNAP_SETTINGS: TimelineSnapSettings = {
  frameSnapMode: 'frames',
  snapThresholdPx: 8,
};
