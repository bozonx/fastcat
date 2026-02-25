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

export type ClipAnchorPreset =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | 'custom';

export interface ClipAnchor {
  preset: ClipAnchorPreset;
  /** Normalized [0..1] coordinates in clip local space. Used when preset is 'custom'. */
  x?: number;
  /** Normalized [0..1] coordinates in clip local space. Used when preset is 'custom'. */
  y?: number;
}

export interface ClipScale {
  x: number;
  y: number;
  linked?: boolean;
}

export interface ClipPosition {
  x: number;
  y: number;
}

export interface ClipTransform {
  scale?: ClipScale;
  /** Rotation in degrees */
  rotationDeg?: number;
  /** Translation in compositor pixels, applied to the anchor point */
  position?: ClipPosition;
  anchor?: ClipAnchor;
}

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
  speed?: number;
  audioFromVideoDisabled?: boolean;
  linkedVideoClipId?: string;
  lockToLinkedVideo?: boolean;
  freezeFrameSourceUs?: number;
  opacity?: number;
  effects?: ClipEffect[];
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  transform?: ClipTransform;
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
