import type { Filter, Sprite, ImageSource, RenderTexture, Container } from 'pixi.js';
import type { Input, VideoSampleSink } from 'mediabunny';
import type {
  TextClipStyle,
  ClipTransform,
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
  input?: any;
  sink?: any;
  firstTimestampS?: number;
  sourceDurationUs: number;
  clipKind: 'video' | 'image' | 'solid';
  sourceKind: 'videoFrame' | 'canvas' | 'bitmap';
  imageSource: ImageSource;
  sprite: Sprite;
  lastVideoFrame: VideoFrame | null;
  bitmap: ImageBitmap | null;
}

export interface CompositorClip {
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
  sprite: any; // Sprite | Graphics | Text
  clipType?: 'background' | 'adjustment' | 'media' | 'text' | 'shape' | 'hud';
  clipKind: 'video' | 'image' | 'solid' | 'adjustment' | 'text' | 'shape' | 'hud';
  sourceKind: 'videoFrame' | 'canvas' | 'bitmap' | 'graphics';
  imageSource: ImageSource;
  lastVideoFrame: VideoFrame | null;
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
  bitmap: ImageBitmap | null;
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
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: VideoClipEffect[];
  transform?: ClipTransform;
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
  textDirty?: boolean;
  shapeDirty?: boolean;
  hudDirty?: boolean;
  hudMediaStates?: {
    background?: HudMediaState;
    content?: HudMediaState;
  };
  mask?: ClipMask;
  maskState?: HudMediaState | null;
}

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
    value === 'darken' ||
    value === 'lighten'
    ? value
    : 'normal';
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
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.color === b.color &&
    a.align === b.align &&
    a.verticalAlign === b.verticalAlign &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing &&
    a.backgroundColor === b.backgroundColor &&
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
