import type {
  BLEND_MODES,
  Filter,
  Sprite,
  Graphics,
  ImageSource,
  RenderTexture,
  Container,
} from 'pixi.js';
import type { Input, VideoSampleSink } from 'mediabunny';
import type {
  TextClipStyle,
  ClipTransform,
  ClipSourceOrientation,
  ClipTransition,
  TimelineBlendMode,
  ShapeType,
  ShapeConfig,
  HudType,
  HudMediaParams,
  VideoClipEffect,
  ClipMask,
} from '~/timeline/types';

export interface HudMediaState {
  sourcePath?: string;
  fileHandle?: FileSystemFileHandle;
  input?: unknown;
  sink?: unknown;
  firstTimestampS?: number;
  frameRate?: number;
  sourceDurationUs: number;
  clipKind: 'video' | 'image' | 'solid';
  sourceKind: 'videoFrame' | 'canvas' | 'bitmap';
  imageSource: ImageSource;
  sprite: Sprite | Graphics | null;
  lastVideoFrame: VideoFrame | ImageBitmap | null;
  bitmap: ImageBitmap | null;
}

export interface BaseCompositorClip {
  itemId: string;
  trackId?: string;
  layer: number;
  sourcePath?: string;
  fileHandle?: FileSystemFileHandle;
  input?: Input;
  sink?: VideoSampleSink;
  firstTimestampS?: number;
  frameRate?: number;
  startUs: number;
  endUs: number;
  durationUs: number;
  sourceStartUs: number;
  /** Duration of the used source range (trimmed), i.e. sourceRange.durationUs */
  sourceRangeDurationUs: number;
  /** Full duration of the source media file, used to compute available handle material */
  sourceDurationUs: number;
  speed?: number;

  freezeFrameSourceUs?: number;
  sprite: Sprite | Graphics | null;
  imageSource: ImageSource;
  lastVideoFrame: VideoFrame | ImageBitmap | null;
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
  bitmap: ImageBitmap | null;
  opacity?: number;
  opacityActive?: boolean;
  blendMode?: TimelineBlendMode;
  blendModeActive?: boolean;
  effects?: VideoClipEffect[];
  transform?: ClipTransform;
  transformActive?: boolean;
  sourceOrientation?: ClipSourceOrientation;
  effectFilters?: Map<string, Filter>;
  transitionIn?: ClipTransition;
  transitionOut?: ClipTransition;
  transitionFilter?: Filter | null;
  transitionFilterType?: string | null;
  transitionSprite?: Sprite | null;
  transitionFromTexture?: RenderTexture | null;
  transitionToTexture?: RenderTexture | null;
  transitionOutputTexture?: RenderTexture | null;
  transitionCombinedTexture?: RenderTexture | null;
  adjustmentSourceTexture?: RenderTexture | null;
  cropMask?: import('pixi.js').Graphics;
  cropMaskKey?: string;
  mask?: ClipMask;
  maskActive?: boolean;
  maskState?: HudMediaState | null;
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
  textDirty?: boolean;
  shapeDirty?: boolean;
  hudDirty?: boolean;
  /** Cache key for non-video WebGPU effect processing — skips reprocessing when unchanged. */
  nonVideoEffectCacheKey?: string;
  /**
   * Original unpadded source dimensions, stored when WebGPU effects pad the
   * imageSource (blur bleed). `applyClipLayoutForCurrentSource` reads these
   * instead of the (now larger) `imageSource.width/height` so the content
   * isn't shrunk to fit the padded texture.
   */
  effectSourceW?: number;
  effectSourceH?: number;
  /** Whether the effect layout should ignore the clip transform (blur-fill). */
  effectIgnoreTransform?: boolean;
  hudMediaStates?: {
    background?: HudMediaState;
    content?: HudMediaState;
    frame?: HudMediaState;
  };
  /** Intrinsic video rotation from source metadata (e.g. 90 for phone vertical video). Applied automatically by LayoutApplier. */
  sourceRotation?: number;
}

export interface MediaCompositorClipBase extends BaseCompositorClip {
  clipType: 'media';
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
}

export interface VideoCompositorClip extends MediaCompositorClipBase {
  clipKind: 'video';
  sourceKind: 'videoFrame';
  input?: Input;
  sink?: VideoSampleSink;
  firstTimestampS?: number;
  frameRate?: number;
  /** Intrinsic video rotation from source metadata (e.g. 90 for phone vertical video). Applied automatically by LayoutApplier. */
  sourceRotation?: number;
}

export interface ImageCompositorClip extends MediaCompositorClipBase {
  clipKind: 'image';
  sourceKind: 'bitmap';
}

export interface SolidCompositorClip extends BaseCompositorClip {
  clipType: 'background';
  clipKind: 'solid';
  sourceKind: 'bitmap';
  backgroundColor: string;
}

export interface AdjustmentCompositorClip extends BaseCompositorClip {
  clipType: 'adjustment';
  clipKind: 'adjustment';
  sourceKind: 'bitmap';
  adjustmentSourceTexture?: RenderTexture | null;
}

export interface TextCompositorClip extends BaseCompositorClip {
  clipType: 'text';
  clipKind: 'text';
  sourceKind: 'canvas';
  text: string;
  style?: TextClipStyle;
  textDirty?: boolean;
}

export interface ShapeCompositorClip extends BaseCompositorClip {
  clipType: 'shape';
  clipKind: 'shape';
  sourceKind: 'graphics';
  shapeType: ShapeType;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  shapeConfig?: ShapeConfig;
  shapeDirty?: boolean;
}

export interface HudCompositorClip extends BaseCompositorClip {
  clipType: 'hud';
  clipKind: 'hud';
  sourceKind: 'bitmap';
  hudType: HudType;
  background?: HudMediaParams;
  content?: HudMediaParams;
  frame?: HudMediaParams;
  hudDirty?: boolean;
  hudMediaStates?: {
    background?: HudMediaState;
    content?: HudMediaState;
    frame?: HudMediaState;
  };
}

export type CompositorClip =
  | VideoCompositorClip
  | ImageCompositorClip
  | SolidCompositorClip
  | AdjustmentCompositorClip
  | TextCompositorClip
  | ShapeCompositorClip
  | HudCompositorClip;

export interface CompositorTrack {
  id: string;
  layer: number;
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: VideoClipEffect[];
  container: Container;
  effectFilters?: Map<string, Filter>;
}

export function resolveBlendMode(value: unknown): TimelineBlendMode {
  return value === 'add' ||
    value === 'multiply' ||
    value === 'screen' ||
    value === 'overlay' ||
    value === 'darken' ||
    value === 'lighten' ||
    value === 'color-dodge' ||
    value === 'color-burn' ||
    value === 'hard-light' ||
    value === 'soft-light' ||
    value === 'difference' ||
    value === 'exclusion' ||
    value === 'hue' ||
    value === 'saturation' ||
    value === 'color' ||
    value === 'luminosity'
    ? value
    : 'normal';
}

export function toPixiBlendMode(value: TimelineBlendMode | undefined): BLEND_MODES {
  return (value ?? 'normal') as unknown as BLEND_MODES;
}

export function isEdgePadding(
  value: TextClipStyle['padding'],
): value is Extract<
  TextClipStyle['padding'],
  { top?: number; right?: number; bottom?: number; left?: number }
> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    ('top' in value || 'right' in value || 'bottom' in value || 'left' in value)
  );
}

export function arePaddingValuesEqual(
  a: TextClipStyle['padding'],
  b: TextClipStyle['padding'],
): boolean {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') {
    return a === b;
  }
  if (!a || !b) return !a && !b;
  if (!isEdgePadding(a) || !isEdgePadding(b)) return false;
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

export function areTextClipStylesEqual(a?: TextClipStyle, b?: TextClipStyle): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;

  return (
    a.width === b.width &&
    a.height === b.height &&
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.color === b.color &&
    a.colorAlpha === b.colorAlpha &&
    a.textShadowEnabled === b.textShadowEnabled &&
    a.textShadowColor === b.textShadowColor &&
    a.textShadowAlpha === b.textShadowAlpha &&
    a.textShadowBlur === b.textShadowBlur &&
    a.textShadowSpread === b.textShadowSpread &&
    a.textShadowOffsetX === b.textShadowOffsetX &&
    a.textShadowOffsetY === b.textShadowOffsetY &&
    a.align === b.align &&
    a.verticalAlign === b.verticalAlign &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing &&
    a.backgroundEnabled === b.backgroundEnabled &&
    a.backgroundColor === b.backgroundColor &&
    a.backgroundAlpha === b.backgroundAlpha &&
    a.backgroundRadius === b.backgroundRadius &&
    a.backgroundShadowEnabled === b.backgroundShadowEnabled &&
    a.backgroundShadowColor === b.backgroundShadowColor &&
    a.backgroundShadowAlpha === b.backgroundShadowAlpha &&
    a.backgroundShadowBlur === b.backgroundShadowBlur &&
    a.backgroundShadowSpread === b.backgroundShadowSpread &&
    a.backgroundShadowOffsetX === b.backgroundShadowOffsetX &&
    a.backgroundShadowOffsetY === b.backgroundShadowOffsetY &&
    a.borderEnabled === b.borderEnabled &&
    a.borderColor === b.borderColor &&
    a.borderAlpha === b.borderAlpha &&
    a.borderWidth === b.borderWidth &&
    a.borderOffset === b.borderOffset &&
    a.paddingLinked === b.paddingLinked &&
    arePaddingValuesEqual(a.padding, b.padding)
  );
}

export function areShapeConfigsEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}
