import { z } from 'zod';
import type {
  TimelineClipType,
  ShapeType,
  HudType,
  AudioFadeCurve,
  TimelineBlendMode,
} from '../types';

export const ClipScaleSchema = z.object({
  x: z.number().catch(1),
  y: z.number().catch(1),
  linked: z.boolean().optional(),
});

export const ClipAnchorPresetSchema = z.enum([
  'center',
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
  'custom',
]);

export const ClipAnchorSchema = z.object({
  preset: ClipAnchorPresetSchema.catch('center'),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const ClipPositionSchema = z.object({
  x: z.number().catch(0),
  y: z.number().catch(0),
});

export const ClipTransformSchema = z.object({
  scale: ClipScaleSchema.optional(),
  rotationDeg: z.number().optional(),
  position: ClipPositionSchema.optional(),
  anchor: ClipAnchorSchema.optional(),
});

export const ClipMaskSchema = z.object({
  source: z.object({ path: z.string() }).optional(),
  mode: z.enum(['alpha', 'luma']).optional(),
  invert: z.boolean().optional(),
});

export const TextClipStyleSchema = z.object({
  width: z.number().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  color: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  backgroundColor: z.string().optional(),
  padding: z.any().optional(), // Can be number or object
});

export const ShapeConfigSchema = z.object({
  squashX: z.number().optional(),
  squashY: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  cornerRadius: z.number().optional(),
  baseLength: z.number().optional(),
  vertexOffset: z.number().optional(),
  rays: z.number().optional(),
  innerRadius: z.number().optional(),
  cloudType: z.union([z.literal(1), z.literal(2)]).optional(),
  pointerSharpness: z.number().optional(),
  pointerAngle: z.number().optional(),
  pointerX: z.number().optional(),
  pointerDirection: z.enum(['left', 'right']).optional(),
});

export const HudMediaParamsSchema = z.object({
  source: z.object({ path: z.string() }).optional(),
  sourceKind: z.enum(['media', 'timeline']).optional(),
  transitionIn: z.any().optional(),
  transitionOut: z.any().optional(),
  effects: z.array(z.any()).optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  shadow: z
    .object({
      enabled: z.boolean().optional(),
      blur: z.number().optional(),
      color: z.string().optional(),
      offsetX: z.number().optional(),
      offsetY: z.number().optional(),
      alpha: z.number().optional(),
    })
    .optional(),
});

export const TimelineClipTypeSchema = z.enum([
  'media',
  'timeline',
  'adjustment',
  'background',
  'text',
  'shape',
  'hud',
]);
export const TimelineBlendModeSchema = z.enum([
  'normal',
  'add',
  'multiply',
  'screen',
  'darken',
  'lighten',
]);
export const AudioFadeCurveSchema = z.enum(['linear', 'logarithmic']);

export const TimelineClipFastCatMetaSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    clipType: TimelineClipTypeSchema.optional(),
    locked: z.boolean().optional(),
    speed: z.number().min(-10).max(10).optional(),
    audioGain: z.number().min(0).max(10).optional(),
    audioBalance: z.number().min(-1).max(1).optional(),
    audioFadeInUs: z.number().min(0).optional(),
    audioFadeOutUs: z.number().min(0).optional(),
    audioFadeInCurve: AudioFadeCurveSchema.optional(),
    audioFadeOutCurve: AudioFadeCurveSchema.optional(),
    audioMuted: z.boolean().optional(),
    audioWaveformMode: z.enum(['half', 'full']).optional(),
    showWaveform: z.boolean().optional(),
    audioFromVideoDisabled: z.boolean().optional(),
    freezeFrameSourceUs: z.number().min(0).optional(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: TimelineBlendModeSchema.optional(),
    linkedGroupId: z.string().trim().min(1).optional(),
    linkedVideoClipId: z.string().trim().min(1).optional(),
    lockToLinkedVideo: z.boolean().optional(),
    isImage: z.boolean().optional(),
    transform: ClipTransformSchema.optional(),
    mask: ClipMaskSchema.optional(),
    sourceDurationUs: z.number().min(0).optional(),
    effects: z.array(z.any()).optional(),
    transitionIn: z.any().optional(),
    transitionOut: z.any().optional(),

    // Type specific extensions
    backgroundColor: z.string().optional(), // Background
    text: z.string().optional(), // Text
    style: TextClipStyleSchema.optional(), // Text
    shapeType: z
      .enum(['square', 'circle', 'triangle', 'star', 'cloud', 'speech_bubble', 'bang'])
      .optional(), // Shape
    fillColor: z.string().optional(), // Shape
    strokeColor: z.string().optional(), // Shape
    strokeWidth: z.number().min(0).optional(), // Shape
    shapeConfig: ShapeConfigSchema.optional(), // Shape
    hudType: z.enum(['media_frame']).optional(), // Hud
    background: HudMediaParamsSchema.optional(), // Hud
    content: HudMediaParamsSchema.optional(), // Hud
    frame: HudMediaParamsSchema.optional(), // Hud
  })
  .catch({});

export const TimelineTrackFastCatMetaSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    name: z.string().optional(),
    kind: z.enum(['video', 'audio']).optional(),
    videoHidden: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: TimelineBlendModeSchema.optional(),
    audioMuted: z.boolean().optional(),
    audioSolo: z.boolean().optional(),
    audioGain: z.number().min(0).max(10).optional(),
    audioBalance: z.number().min(-1).max(1).optional(),
    effects: z.array(z.any()).optional(),
    color: z.string().optional(),
    locked: z.boolean().optional(),
  })
  .catch({});

export const TimelineDocFastCatMetaSchema = z
  .object({
    version: z.number().optional(),
    docId: z.string().trim().min(1).optional(),
    timebase: z.object({ fps: z.number() }).optional(),
    selectionRange: z.object({ startUs: z.number(), endUs: z.number() }).optional(),
    snapThresholdPx: z.number().min(1).optional(),
    playheadUs: z.number().min(0).optional(),
    masterGain: z.number().optional(),
    masterMuted: z.boolean().optional(),
    masterEffects: z.array(z.any()).optional(),
    zoom: z.number().optional(),
    trackHeights: z.record(z.string(), z.number()).optional(),
    markers: z.array(z.any()).optional(),
  })
  .catch({});
