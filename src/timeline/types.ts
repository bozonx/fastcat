import type { ClipEffect as BaseClipEffect } from '../effects/core/registry';
import type { ColorAdjustmentParams } from '../effects/video/color-adjustment/manifest';
import type { BlurParams } from '../effects/video/blur/manifest';

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

export type ColorAdjustmentEffect = BaseClipEffect<ColorAdjustmentParams> & {
  type: 'color-adjustment';
};
export type BlurEffect = BaseClipEffect<BlurParams> & { type: 'blur' };

export type ClipEffect = ColorAdjustmentEffect | BlurEffect;

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
  videoHidden?: boolean;
  audioMuted?: boolean;
  audioSolo?: boolean;
  effects?: ClipEffect[];
  items: TimelineTrackItem[];
}

export interface TimelineDocument {
  OTIO_SCHEMA: 'Timeline.1';
  id: string;
  name: string;
  timebase: TimelineTimebase;
  tracks: TimelineTrack[];
}
