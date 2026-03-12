import type { ClipEffect as BaseClipEffect, EffectTarget } from '../effects/core/registry';
import type { TransitionCurve, TransitionMode } from '../transitions';

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

export type TimelineClipType =
  | 'media'
  | 'timeline'
  | 'adjustment'
  | 'background'
  | 'text'
  | 'shape'
  | 'hud';

export type TimelineBlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'darken' | 'lighten';

export interface TextClipStyle {
  width?: number;
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
  mode?: TransitionMode;
  /** True if the user manually changed the transition mode */
  isOverridden?: boolean;
  /** Opacity interpolation curve */
  curve?: TransitionCurve;
  params?: Record<string, unknown>;
}

export type ClipEffect<TParams = Record<string, any>> = BaseClipEffect<TParams>;

export type VideoClipEffect<TParams = Record<string, any>> = ClipEffect<TParams> & {
  target?: 'video';
};

export type AudioClipEffect<TParams = Record<string, any>> = ClipEffect<TParams> & {
  target: 'audio';
};

export type TimelineEffect<TParams = Record<string, any>> = ClipEffect<TParams> & {
  target?: EffectTarget;
};

interface TimelineClipBase {
  kind: 'clip';
  clipType: TimelineClipType;
  id: string;
  trackId: string;
  name: string;
  disabled?: boolean;
  locked?: boolean;
  linkedGroupId?: string;
  timelineRange: TimelineRange;
  sourceRange: TimelineRange;
  source?: TimelineSourceRef;
  sourceDurationUs?: number;
  speed?: number;

  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFadeInCurve?: 'linear' | 'logarithmic';
  audioFadeOutCurve?: 'linear' | 'logarithmic';
  audioMuted?: boolean;
  audioWaveformMode?: 'half' | 'full';
  showWaveform?: boolean;
  showThumbnails?: boolean;
  audioFromVideoDisabled?: boolean;
  linkedVideoClipId?: string;
  lockToLinkedVideo?: boolean;
  freezeFrameSourceUs?: number;
  isImage?: boolean;
  opacity?: number;
  blendMode?: TimelineBlendMode;
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

export type ShapeType =
  | 'square'
  | 'circle'
  | 'triangle'
  | 'star'
  | 'cloud'
  | 'speech_bubble'
  | 'bang';

export interface ShapeConfig {
  // Circle
  squashX?: number; // %
  squashY?: number; // %
  // Square
  width?: number;
  height?: number;
  cornerRadius?: number;
  // Triangle
  baseLength?: number;
  vertexOffset?: number;
  // Star & Bang
  rays?: number;
  innerRadius?: number;
  // Cloud
  cloudType?: 1 | 2;
  // Speech Bubble
  pointerSharpness?: number;
  pointerAngle?: number;
  pointerX?: number;
  pointerDirection?: 'left' | 'right';
}

export interface TimelineShapeClipItem extends TimelineClipBase {
  clipType: 'shape';
  shapeType: ShapeType;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shapeConfig?: ShapeConfig;
}

export type HudType = 'media_frame';

export interface HudMediaParams {
  source?: TimelineSourceRef;
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  effects?: ClipEffect[];
}

export interface TimelineHudClipItem extends TimelineClipBase {
  clipType: 'hud';
  hudType: HudType;
  background?: HudMediaParams;
  content?: HudMediaParams;
}

export type TimelineClipItem =
  | TimelineMediaClipItem
  | TimelineTimelineClipItem
  | TimelineAdjustmentClipItem
  | TimelineBackgroundClipItem
  | TimelineTextClipItem
  | TimelineShapeClipItem
  | TimelineHudClipItem;

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
  opacity?: number;
  blendMode?: TimelineBlendMode;
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
  durationUs?: number;
  text: string;
  color?: string;
}

export interface TimelineSelectionRange {
  startUs: number;
  endUs: number;
}

export interface TimelineGranMetadata {
  version?: number;
  docId?: string;
  timebase?: TimelineTimebase;
  markers?: TimelineMarker[];
  selectionRange?: TimelineSelectionRange;
  playheadUs?: number;
  masterGain?: number;
  masterMuted?: boolean;
  masterEffects?: ClipEffect[];
  snapThresholdPx?: number;
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
