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

export type TimelineClipType = 'media' | 'timeline' | 'adjustment' | 'background' | 'text';

export interface TextClipStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  letterSpacing?: number;
  backgroundColor?: string;
  padding?:
    | number
    | { x?: number; y?: number }
    | { top?: number; right?: number; bottom?: number; left?: number };
}

export type ClipAnchorPreset =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | 'custom';

export interface ClipAnchor {
  preset: ClipAnchorPreset;
  /** Normalized coordinates in clip local space. Usually [0..1] but can extend beyond for custom rotation points (e.g. -10..10). Used when preset is 'custom'. */
  x?: number;
  /** Normalized coordinates in clip local space. Usually [0..1] but can extend beyond for custom rotation points (e.g. -10..10). Used when preset is 'custom'. */
  y?: number;
}

export interface ClipScale {
  /** Scale factor for X axis. Negative values flip the clip horizontally. */
  x: number;
  /** Scale factor for Y axis. Negative values flip the clip vertically. */
  y: number;
  /** UI-only flag to lock proportions when resizing */
  linked?: boolean;
}

export interface ClipPosition {
  /** Absolute translation in compositor pixels, applied relative to the anchor point */
  x: number;
  /** Absolute translation in compositor pixels, applied relative to the anchor point */
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
  disabled?: boolean;
  locked?: boolean;
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  source?: TimelineSourceRef;
  sourceDurationUs?: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFromVideoDisabled?: boolean;
  linkedVideoClipId?: string;
  lockToLinkedVideo?: boolean;
  freezeFrameSourceUs?: number;
  isImage?: boolean;
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

export interface TimelineTextClipItem extends TimelineClipBase {
  clipType: 'text';
  text: string;
  style?: TextClipStyle;
}

export type TimelineClipItem =
  | TimelineMediaClipItem
  | TimelineTimelineClipItem
  | TimelineAdjustmentClipItem
  | TimelineBackgroundClipItem
  | TimelineTextClipItem;

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
  audioGain?: number;
  audioBalance?: number;
  effects?: ClipEffect[];
  items: TimelineTrackItem[];
}

export interface TimelineMarker {
  id: string;
  timeUs: number;
  text: string;
}

export interface TimelineGranMetadata {
  docId?: string;
  timebase?: TimelineTimebase;
  markers?: TimelineMarker[];
  playheadUs?: number;
}

export interface TimelineMetadata {
  gran?: TimelineGranMetadata;
  [key: string]: unknown;
}

export interface TimelineDocument {
  OTIO_SCHEMA: 'Timeline.1';
  id: string;
  name: string;
  timebase: TimelineTimebase;
  tracks: TimelineTrack[];
  metadata?: TimelineMetadata;
}
