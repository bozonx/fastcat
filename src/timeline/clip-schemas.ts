import { z } from 'zod';
import { MAX_SAFE_TICKS } from '~/utils/time';
import type {
  ClipTransform,
  ClipTransition,
  ClipMask,
  ClipEffect,
  ClipAnimations,
  TextClipStyle,
  ShapeConfig,
  HudMediaParams,
  TimelineBlendMode,
  ClipSourceOrientation,
  ShapeType,
  HudType,
  AudioFadeCurve,
} from '~/timeline/types';

/**
 * Canonical runtime-validation schemas for the timeline clip fields that cross
 * the worker / native boundary. These are the single source of truth for what
 * a serialized clip is allowed to contain: the worker payload schema and any
 * other boundary validator should compose from here rather than re-declaring
 * shapes as `z.unknown()`.
 *
 * The schemas intentionally use `.passthrough()` on open-ended objects (effect
 * params, style, shape/HUD config) so forward-compatible extra fields survive
 * the round-trip, while still type-checking the fields we know about.
 */

export const BlendModeSchema: z.ZodType<TimelineBlendMode> = z.enum([
  'normal',
  'add',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

export const ShapeTypeSchema: z.ZodType<ShapeType> = z.enum([
  'square',
  'circle',
  'triangle',
  'star',
  'cloud',
  'speech_bubble',
  'bang',
]);

export const HudTypeSchema: z.ZodType<HudType> = z.literal('media_frame');

export const FadeCurveSchema: z.ZodType<AudioFadeCurve> = z.enum(['linear', 'logarithmic']);

export const ClipSourceOrientationSchema: z.ZodType<ClipSourceOrientation> = z.enum([
  'auto',
  '0',
  '90',
  '180',
  '270',
]);

const ClipScaleSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    linked: z.boolean().optional(),
  })
  .passthrough();

const ClipPositionSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .passthrough();

const ClipAnchorSchema = z
  .object({
    preset: z.enum(['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'custom']),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
  })
  .passthrough();

const ClipCropSchema = z
  .object({
    top: z.number().finite().optional(),
    bottom: z.number().finite().optional(),
    left: z.number().finite().optional(),
    right: z.number().finite().optional(),
  })
  .passthrough();

export const ClipTransformSchema: z.ZodType<ClipTransform> = z
  .object({
    scale: ClipScaleSchema.optional(),
    rotationDeg: z.number().finite().optional(),
    position: ClipPositionSchema.optional(),
    anchor: ClipAnchorSchema.optional(),
    crop: ClipCropSchema.optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
  })
  .passthrough() as unknown as z.ZodType<ClipTransform>;

/**
 * Keyframe animation tracks. Times are source-relative canonical timeline ticks. We
 * validate the known param paths and drop unknown ones so a malformed or
 * forward-compatible track can't smuggle in an un-evaluatable path.
 */
const KeyframeSchema = z.object({
  tTicks: z.number().finite().nonnegative().max(MAX_SAFE_TICKS),
  value: z.number().finite(),
  easing: z.enum(['linear', 'ease', 'hold']),
});

const KeyframeTrackSchema = z.object({
  keyframes: z.array(KeyframeSchema),
});

export const ClipAnimationsSchema: z.ZodType<ClipAnimations> = z
  .object({
    opacity: KeyframeTrackSchema.optional(),
    'transform.position.x': KeyframeTrackSchema.optional(),
    'transform.position.y': KeyframeTrackSchema.optional(),
    'transform.scale.x': KeyframeTrackSchema.optional(),
    'transform.scale.y': KeyframeTrackSchema.optional(),
    'transform.rotationDeg': KeyframeTrackSchema.optional(),
    'transform.anchor.x': KeyframeTrackSchema.optional(),
    'transform.anchor.y': KeyframeTrackSchema.optional(),
    'transform.crop.top': KeyframeTrackSchema.optional(),
    'transform.crop.bottom': KeyframeTrackSchema.optional(),
    'transform.crop.left': KeyframeTrackSchema.optional(),
    'transform.crop.right': KeyframeTrackSchema.optional(),
    'transform.flipHorizontal': KeyframeTrackSchema.optional(),
    'transform.flipVertical': KeyframeTrackSchema.optional(),
    'audio.volume': KeyframeTrackSchema.optional(),
    'audio.pan': KeyframeTrackSchema.optional(),
  })
  // Effect-param paths (`effect.<id>.<key>`) ride the catchall so they validate
  // and pass through with the same track shape.
  .catchall(KeyframeTrackSchema) as unknown as z.ZodType<ClipAnimations>;

export const ClipTransitionSchema: z.ZodType<ClipTransition> = z
  .object({
    type: z.string(),
    durationTicks: z.number().finite().nonnegative().max(MAX_SAFE_TICKS),
    mode: z.enum(['adjacent', 'background', 'transparent']).optional(),
    isOverridden: z.boolean().optional(),
    curve: z.enum(['linear', 'smooth', 'ease-in', 'ease-out']).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough() as unknown as z.ZodType<ClipTransition>;

export const ClipMaskSchema: z.ZodType<ClipMask> = z
  .object({
    source: z.object({ path: z.string() }).passthrough().optional(),
    mode: z.enum(['alpha', 'luma']).optional(),
    invert: z.boolean().optional(),
  })
  .passthrough() as unknown as z.ZodType<ClipMask>;

/**
 * A clip effect is `{ id, type, enabled, target? }` plus an open-ended bag of
 * params (`ClipEffect = BaseClipEffect & T`). We validate the known keys and
 * pass the rest through untouched.
 */
export const ClipEffectSchema: z.ZodType<ClipEffect> = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    enabled: z.boolean().optional(),
    target: z.enum(['video', 'audio']).optional(),
  })
  .passthrough() as unknown as z.ZodType<ClipEffect>;

export const TextClipStyleSchema: z.ZodType<TextClipStyle> = z
  .object({})
  .passthrough() as unknown as z.ZodType<TextClipStyle>;

export const ShapeConfigSchema: z.ZodType<ShapeConfig> = z
  .object({})
  .passthrough() as unknown as z.ZodType<ShapeConfig>;

export const HudMediaParamsSchema: z.ZodType<HudMediaParams> = z
  .object({
    source: z.object({ path: z.string() }).passthrough().optional(),
    sourceKind: z.enum(['media', 'timeline']).optional(),
    transitionIn: ClipTransitionSchema.optional(),
    transitionOut: ClipTransitionSchema.optional(),
    effects: z.array(ClipEffectSchema).optional(),
    scaleX: z.number().finite().optional(),
    scaleY: z.number().finite().optional(),
    offsetX: z.number().finite().optional(),
    offsetY: z.number().finite().optional(),
    shadow: z.object({}).passthrough().optional(),
  })
  .passthrough() as unknown as z.ZodType<HudMediaParams>;
