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

export type TimelineClipType = 'media' | 'timeline' | 'adjustment' | 'background';

export interface ClipTransition {
  type: string;
  durationUs: number;
  /** 'blend' = cross-fade with the previous clip on the same track (default). 'composite' = fade with lower tracks */
  mode?: 'blend' | 'composite';
  /** Opacity interpolation curve */
  curve?: 'linear' | 'bezier';
}

export type ColorAdjustmentEffect = BaseClipEffect<ColorAdjustmentParams> & {
  type: 'color-adjustment';
};
export type BlurEffect = BaseClipEffect<BlurParams> & { type: 'blur' };

export type ClipEffect = ColorAdjustmentEffect | BlurEffect;

interface TimelineClipBase {
  kind: 'clip';
  clipType: TimelineClipType;
  id: string;
  trackId: string;
  name: string;
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  source?: TimelineSourceRef;
  sourceDurationUs?: number;
  audioFromVideoDisabled?: boolean;
  linkedVideoClipId?: string;
  lockToLinkedVideo?: boolean;
  freezeFrameSourceUs?: number;
  opacity?: number;
  effects?: ClipEffect[];
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
}

export interface TimelineMediaClipItem extends TimelineClipBase {
  clipType: 'media';
  source: TimelineSourceRef;
  sourceDurationUs: number;
}

export interface TimelineTimelineClipItem extends TimelineClipBase {
  clipType: 'timeline';
  source: TimelineSourceRef;
  sourceDurationUs: number;
}

export interface TimelineAdjustmentClipItem extends TimelineClipBase {
  clipType: 'adjustment';
}

export interface TimelineBackgroundClipItem extends TimelineClipBase {
  clipType: 'background';
  backgroundColor: string;
}

export type TimelineClipItem =
  | TimelineMediaClipItem
  | TimelineTimelineClipItem
  | TimelineAdjustmentClipItem
  | TimelineBackgroundClipItem;

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
