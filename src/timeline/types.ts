import type { ClipEffect as BaseClipEffect, EffectTarget } from '../effects/core/registry';
import type { TransitionCurve, TransitionMode } from '../transitions';
import type { FrameRate } from '~/utils/time/ticks';

export type TrackKind = 'video' | 'audio';

export interface TimelineTimebase extends Partial<FrameRate> {
  /** Legacy persisted field, accepted on read and replaced with num/den on write. */
  fps?: number;
}

export type TimelineFormatSettingsSource = 'projectDefaults' | 'firstClip' | 'manual';

export interface TimelineFormat {
  width: number;
  height: number;
  fps: number;
  resolutionFormat: string;
  orientation: 'landscape' | 'portrait';
  aspectRatio: string;
  isCustomResolution: boolean;
  sampleRate: number;
  isAutoSettings: boolean;
  geometryResolved: boolean;
  sampleRateResolved: boolean;
  settingsSource: TimelineFormatSettingsSource;
  useProjectSettings?: boolean;
}

export interface TimelineRange {
  /** Start time in canonical timeline ticks (TICKS_PER_SECOND per second). */
  startTicks: number;
  /** Duration in canonical timeline ticks (TICKS_PER_SECOND per second). */
  durationTicks: number;
}

export interface TimelineSourceRef {
  path: string;
}

export type TimelineClipType =
  'media' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';

export type TimelineBlendMode =
  | 'normal'
  | 'add'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface TextClipStyle {
  width?: number;
  height?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  color?: string;
  colorAlpha?: number;
  textShadowEnabled?: boolean;
  textShadowColor?: string;
  textShadowAlpha?: number;
  textShadowBlur?: number;
  textShadowSpread?: number;
  textShadowOffsetX?: number;
  textShadowOffsetY?: number;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  letterSpacing?: number;
  backgroundEnabled?: boolean;
  backgroundColor?: string;
  backgroundAlpha?: number;
  backgroundRadius?: number;
  backgroundShadowEnabled?: boolean;
  backgroundShadowColor?: string;
  backgroundShadowAlpha?: number;
  backgroundShadowBlur?: number;
  backgroundShadowSpread?: number;
  backgroundShadowOffsetX?: number;
  backgroundShadowOffsetY?: number;
  borderEnabled?: boolean;
  borderColor?: string;
  borderAlpha?: number;
  borderWidth?: number;
  /**
   * Creative gap between the background box and the border, in design-space px.
   * 0 keeps the border hugging the background (a 1px overlap that hides the AA
   * seam); larger values push the border outward, revealing the scene in between.
   */
  borderOffset?: number;
  paddingLinked?: boolean;
  padding?:
    | number
    | { x?: number; y?: number }
    | { top?: number; right?: number; bottom?: number; left?: number };
}

export type ClipAnchorPreset =
  'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'custom';

export interface ClipAnchor {
  preset: ClipAnchorPreset;
  /** Normalized coordinates in clip local space. Usually [0..1] but can extend beyond for custom rotation points (e.g. -10..10). Used when preset is 'custom'. */
  x?: number;
  /** Normalized coordinates in clip local space. Usually [0..1] but can extend beyond for custom rotation points (e.g. -10..10). Used when preset is 'custom'. */
  y?: number;
}

export interface ClipScale {
  /** Scale factor for X axis. Must be positive (reflection uses flipHorizontal). */
  x: number;
  /** Scale factor for Y axis. Must be positive (reflection uses flipVertical). */
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

export interface ClipCrop {
  /** Top crop in percent (0..100) */
  top?: number;
  /** Bottom crop in percent (0..100) */
  bottom?: number;
  /** Left crop in percent (0..100) */
  left?: number;
  /** Right crop in percent (0..100) */
  right?: number;
}

export interface ClipTransform {
  scale?: ClipScale;
  /** Rotation in degrees */
  rotationDeg?: number;
  /** Translation in compositor pixels, applied to the anchor point */
  position?: ClipPosition;
  anchor?: ClipAnchor;
  crop?: ClipCrop;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export type ClipSourceOrientation = 'auto' | '0' | '90' | '180' | '270';

/**
 * Keyframe animation.
 *
 * Keyframe times are **source-relative**: `tTicks` is measured in canonical timeline
 * ticks (`TICKS_PER_SECOND` per second) from the source media/timeline start.
 * Moving/rippling a clip keeps its animation intact, while trim and speed change
 * which part of the source-time animation is sampled. The mapping from the
 * timeline playhead to source time lives in the render/editor bridge.
 */
export type KeyframeEasing =
  /** Constant-rate interpolation to the next keyframe. */
  | 'linear'
  /** Smooth ease-in-out (smoothstep) to the next keyframe. */
  | 'ease'
  /** Hold this value until the next keyframe, then jump. */
  | 'hold';

export interface Keyframe {
  /** Time in canonical timeline ticks from the source media/timeline start (always >= 0). */
  tTicks: number;
  /** The animated parameter's value at `tTicks`. */
  value: number;
  /**
   * Interpolation from THIS keyframe to the next one. Ignored on the last
   * keyframe of a track (nothing follows it).
   */
  easing: KeyframeEasing;
}

export interface KeyframeTrack {
  /**
   * Keyframes sorted ascending by `tTicks` with unique times. This invariant is
   * enforced by the schema (`ClipAnimationsSchema`) and the command layer
   * (`normalizeKeyframeTrack`); evaluators rely on it.
   */
  keyframes: Keyframe[];
}

/** The fixed transform/opacity keyframe paths (stable, render-applied directly). */
export type FixedAnimatableParamPath =
  | 'opacity'
  | 'audio.volume'
  | 'audio.pan'
  | 'transform.position.x'
  | 'transform.position.y'
  | 'transform.scale.x'
  | 'transform.scale.y'
  | 'transform.rotationDeg'
  | 'transform.anchor.x'
  | 'transform.anchor.y'
  | 'transform.crop.top'
  | 'transform.crop.bottom'
  | 'transform.crop.left'
  | 'transform.crop.right'
  | 'transform.flipHorizontal'
  | 'transform.flipVertical';

/**
 * A keyframable numeric/boolean parameter of a clip effect, addressed by the
 * effect instance id and the effect's UI value key: `effect.<effectId>.<key>`.
 * (Colours animate as per-channel keys, e.g. `effect.<id>.tintColor.r`.) These
 * are sampled and "baked" to `VideoEffectSpec` fields at render time — see
 * `src/effects/animation-bake.ts` — rather than applied to the clip directly.
 */
export type EffectAnimatableParamPath = `effect.${string}.${string}`;

/**
 * A clip parameter that can be keyframed: the fixed transform/opacity set plus
 * dynamic effect-parameter paths. Kept as a (mostly) closed union so the
 * fixed paths stay type-safe, while effect paths ride the template-literal arm.
 */
export type AnimatableParamPath = FixedAnimatableParamPath | EffectAnimatableParamPath;

/** Per-clip keyframe tracks, keyed by the animated parameter path. */
export type ClipAnimations = Partial<Record<AnimatableParamPath, KeyframeTrack>>;

export interface ClipTransition {
  type: string;
  durationTicks: number;
  mode?: TransitionMode;
  /** True if the user manually changed the transition mode */
  isOverridden?: boolean;
  /** Opacity interpolation curve */
  curve?: TransitionCurve;
  params?: Record<string, unknown>;
}

export type ClipEffect<TParams = Record<string, unknown>> = BaseClipEffect<TParams>;

export type VideoClipEffect<TParams = Record<string, unknown>> = ClipEffect<TParams> & {
  target?: 'video';
};

export type AudioClipEffect<TParams = Record<string, unknown>> = ClipEffect<TParams> & {
  target: 'audio';
};

export type TimelineEffect<TParams = Record<string, unknown>> = ClipEffect<TParams> & {
  target?: EffectTarget;
};

export type AudioFadeCurve = 'linear' | 'logarithmic';

export interface ClipMask {
  source?: TimelineSourceRef;
  mode?: 'alpha' | 'luma';
  invert?: boolean;
}

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
  sourceDurationTicks?: number;
  speed?: number;

  audioGain?: number;
  audioBalance?: number;
  originalAudioGain?: number;
  originalAudioBalance?: number;
  audioFadeInTicks?: number;
  audioFadeOutTicks?: number;
  audioFadeInCurve?: AudioFadeCurve;
  audioFadeOutCurve?: AudioFadeCurve;
  audioMuted?: boolean;
  audioWaveformMode?: 'half' | 'full';
  showWaveform?: boolean;
  showThumbnails?: boolean;
  freezeFrameSourceTicks?: number;
  isImage?: boolean;

  opacity?: number;
  opacityActive?: boolean;

  blendMode?: TimelineBlendMode;
  blendModeActive?: boolean;

  mask?: ClipMask;
  maskActive?: boolean;

  effects?: ClipEffect[];
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  transform?: ClipTransform;
  transformActive?: boolean;
  /** Keyframe animation tracks. See {@link ClipAnimations}. */
  animations?: ClipAnimations;
  sourceOrientation?: ClipSourceOrientation;

  speedActive?: boolean;
  audioFadesActive?: boolean;
  layer?: number;
  snapToPixelGrid?: boolean;

  // Optional fields from sub-types to avoid pervasive `as any` casts
  backgroundColor?: string;
  text?: string;
  style?: TextClipStyle;
  shapeType?: ShapeType;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shapeConfig?: ShapeConfig;
  hudType?: HudType;
  background?: HudMediaParams;
  content?: HudMediaParams;
  frame?: HudMediaParams;
}

export interface TimelineMediaClipItem extends TimelineClipBase {
  clipType: 'media';
  source: TimelineSourceRef;
  sourceDurationTicks: number;
}

export interface TimelineTimelineClipItem extends TimelineClipBase {
  clipType: 'timeline';
  source: TimelineSourceRef;
  sourceDurationTicks: number;
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
  snapToPixelGrid?: boolean;
}

export type ShapeType =
  'square' | 'circle' | 'triangle' | 'star' | 'cloud' | 'speech_bubble' | 'bang';

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
  snapToPixelGrid?: boolean;
}

export type HudType = 'media_frame';

export interface HudMediaParams {
  source?: TimelineSourceRef;
  sourceKind?: 'media' | 'timeline';
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  effects?: ClipEffect[];
  scaleX?: number;
  scaleY?: number;
  offsetX?: number;
  offsetY?: number;
  shadow?: {
    enabled?: boolean;
    blur?: number;
    color?: string;
    offsetX?: number;
    offsetY?: number;
    alpha?: number;
  };
}

export interface TimelineHudClipItem extends TimelineClipBase {
  clipType: 'hud';
  hudType: HudType;
  background?: HudMediaParams;
  content?: HudMediaParams;
  frame?: HudMediaParams;
}

export type TimelineClipItem =
  | TimelineMediaClipItem
  | TimelineTimelineClipItem
  | TimelineAdjustmentClipItem
  | TimelineBackgroundClipItem
  | TimelineTextClipItem
  | TimelineShapeClipItem
  | TimelineHudClipItem;

export type TimelineClipPropertiesPatch = Partial<
  Pick<
    TimelineClipItem,
    | 'disabled'
    | 'locked'
    | 'opacity'
    | 'blendMode'
    | 'effects'
    | 'freezeFrameSourceTicks'
    | 'speed'
    | 'speedActive'
    | 'transform'
    | 'transformActive'
    | 'animations'
    | 'sourceOrientation'
    | 'audioGain'
    | 'audioBalance'
    | 'audioFadeInTicks'
    | 'audioFadeOutTicks'
    | 'audioFadeInCurve'
    | 'audioFadeOutCurve'
    | 'audioFadesActive'
    | 'audioMuted'
    | 'audioWaveformMode'
    | 'showWaveform'
    | 'showThumbnails'
    | 'sourceRange'
    | 'sourceDurationTicks'
    | 'source'
    | 'opacityActive'
    | 'blendModeActive'
    | 'mask'
    | 'maskActive'
    | 'snapToPixelGrid'
    | 'linkedGroupId'
    | 'backgroundColor'
    | 'text'
    | 'style'
    | 'shapeType'
    | 'fillColor'
    | 'strokeColor'
    | 'strokeWidth'
    | 'shapeConfig'
    | 'hudType'
    | 'background'
    | 'content'
    | 'frame'
  >
>;

export interface TimelineGapItem {
  kind: 'gap';
  id: string;
  trackId: string;
  timelineRange: TimelineRange;
}

export type TimelineTrackItem = TimelineClipItem | TimelineGapItem;

export function isClipItem(item: TimelineTrackItem): item is TimelineClipItem {
  return item.kind === 'clip';
}

export function isSourceClipItem(
  item: TimelineClipItem,
): item is TimelineMediaClipItem | TimelineTimelineClipItem {
  return item.clipType === 'media' || item.clipType === 'timeline';
}

export interface TimelineTransitionSelection {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
}

export interface TimelineClipActionPayload {
  action:
    | 'extractAudio'
    | 'freezeFrame'
    | 'resetFreezeFrame'
    | 'openAutoMontage'
    | 'trim_item'
    | 'longPress';
  trackId: string;
  itemId: string;
  edge?: 'in' | 'out' | 'end';
  deltaTicks?: number;
  quantizeToFrames?: boolean;
}

export interface TimelineOpenAutoMontageModalPayload {
  itemIds: string[];
}

export interface TimelineOpenSpeedModalPayload {
  trackId: string;
  itemId: string;
  speed: number;
}

export interface TimelineMoveItemPayload {
  trackId: string;
  itemId: string;
  startTicks: number;
  mode?: 'move' | 'slip';
}

export interface TimelineTrimItemPayload {
  trackId: string;
  itemId: string;
  edge: 'start' | 'end';
  startTicks: number;
}

export interface TimelineResizeVolumePayload {
  trackId: string;
  itemId: string;
  gain: number;
  trackHeight: number;
}

export interface TimelineResizeFadePayload {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  durationTicks: number;
  /** Pointer X where the gesture started. Used when resize starts after a drag threshold. */
  pointerStartClientX?: number;
  /** Pre-drag document snapshot for correct undo history. Pass when creation and drag start together. */
  docBeforeDrag?: TimelineDocument | null;
}

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
  color?: string;
  locked?: boolean;
  markers?: TimelineMarker[];
}

export interface TimelineMarker {
  id: string;
  timeTicks: number;
  durationTicks?: number;
  text: string;
  color?: string;
}

export interface TimelineSelectionRange {
  startTicks: number;
  endTicks: number;
}

export interface TimelineFastCatMetadata {
  version?: number;
  docId?: string;
  timebase?: TimelineTimebase;
  format?: TimelineFormat;
  markers?: TimelineMarker[];
  masterEffects?: ClipEffect[];
  masterGain?: number;
  masterMuted?: boolean;
  selectionRange?: TimelineSelectionRange | null;
}

export interface TimelineMetadata {
  fastcat?: TimelineFastCatMetadata;
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
