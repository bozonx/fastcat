export type TrackKind = 'video' | 'audio';

export interface TimelineTimebase {
  fps: number;
}

export interface TimelineRange {
  startUs: number;
  durationUs: number;
}

export interface TimelineSourceRef {
  path: string;
}

export interface ColorAdjustmentEffect {
  id: string;
  type: 'color-adjustment';
  enabled: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
}

export type ClipEffect = ColorAdjustmentEffect;

export interface TimelineClipItem {
  kind: 'clip';
  id: string;
  trackId: string;
  name: string;
  source: TimelineSourceRef;
  sourceDurationUs: number;
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  audioFromVideoDisabled?: boolean;
  linkedVideoClipId?: string;
  lockToLinkedVideo?: boolean;
  opacity?: number;
  effects?: ClipEffect[];
}

export interface TimelineGapItem {
  kind: 'gap';
  id: string;
  trackId: string;
  timelineRange: TimelineRange;
}

export type TimelineTrackItem = TimelineClipItem | TimelineGapItem;

export interface TimelineTrack {
  id: string;
  kind: TrackKind;
  name: string;
  items: TimelineTrackItem[];
}

export interface TimelineDocument {
  OTIO_SCHEMA: 'Timeline.1';
  id: string;
  name: string;
  timebase: TimelineTimebase;
  tracks: TimelineTrack[];
}
