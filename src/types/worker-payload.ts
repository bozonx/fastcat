import { z } from 'zod';
import {
  BlendModeSchema,
  ShapeTypeSchema,
  HudTypeSchema,
  FadeCurveSchema,
  ClipSourceOrientationSchema,
  ClipTransformSchema,
  ClipAnimationsSchema,
  ClipTransitionSchema,
  ClipMaskSchema,
  ClipEffectSchema,
  TextClipStyleSchema,
  ShapeConfigSchema,
  HudMediaParamsSchema,
} from '~/timeline/clip-schemas';

export const ExportOptionsSchema = z.object({
  format: z.enum(['mp4', 'webm', 'mkv', 'aac', 'opus', 'ogg', 'flac', 'wav', 'pcm', 'mp3']),
  videoCodec: z.string().trim().min(1),
  bitrate: z.number().finite().min(1),
  bitrateMode: z.enum(['constant', 'variable']).optional(),
  maxBitrateBps: z.number().finite().nullable().optional(),
  minBitrateBps: z.number().finite().nullable().optional(),
  keyframeIntervalSec: z.number().finite().positive().max(1_000).optional(),
  exportAlpha: z.boolean().optional(),
  fastStart: z.boolean().optional(),
  metadata: z
    .object({
      title: z.string(),
      description: z.string(),
      author: z.string(),
      tags: z.string(),
    })
    .optional(),
  audioBitrate: z.number().finite().min(1),
  audio: z.boolean(),
  audioCodec: z.string().trim().min(1).optional(),
  audioSampleRate: z.number().finite().min(8_000).max(192_000).optional(),
  audioChannels: z.enum(['stereo', 'mono']).optional(),
  width: z
    .number()
    .int()
    .min(2)
    .max(16_384)
    .refine((value) => value % 2 === 0),
  height: z
    .number()
    .int()
    .min(2)
    .max(16_384)
    .refine((value) => value % 2 === 0),
  fps: z.number().finite().min(1).max(240),
  exportRangeUs: z
    .object({ startUs: z.number().finite().min(0), endUs: z.number().finite().min(0) })
    .refine((range) => range.endUs > range.startUs)
    .optional(),
  audioPassthrough: z.boolean().optional(),
});

export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

export const TranscodeOptionsSchema = z.object({
  format: z.enum(['mp4', 'webm', 'mkv', 'aac', 'opus', 'ogg', 'flac', 'wav', 'pcm', 'mp3']),
  videoCodec: z.string().trim().min(1),
  bitrate: z.number().finite().min(1),
  bitrateMode: z.enum(['constant', 'variable']).optional(),
  keyframeIntervalSec: z.number().finite().positive().max(1_000).optional(),
  exportAlpha: z.boolean().optional(),
  fastStart: z.boolean().optional(),
  audioBitrate: z.number().finite().min(1),
  audio: z.boolean(),
  audioCodec: z.string().trim().min(1).optional(),
  audioSampleRate: z.number().finite().min(8_000).max(192_000).optional(),
  audioChannels: z.enum(['stereo', 'mono']).optional(),
  width: z
    .number()
    .int()
    .min(2)
    .max(16_384)
    .refine((value) => value % 2 === 0),
  height: z
    .number()
    .int()
    .min(2)
    .max(16_384)
    .refine((value) => value % 2 === 0),
  fps: z.number().finite().min(1).max(240),
  audioReverse: z.boolean().optional(),
  audioDurationSec: z.number().finite().positive().optional(),
  audioPassthrough: z.boolean().optional(),
});

export type TranscodeOptions = z.infer<typeof TranscodeOptionsSchema>;

// `WorkerTimelineClip`, `WorkerTimelineTrack` and `WorkerTimelineMeta` are
// derived from their zod schemas (see below) so the runtime validation and the
// compile-time type can never drift apart — the schema is the single source of
// truth for the worker-boundary shape.

export type WorkerTrackPayloadSource = Pick<
  import('~/timeline/types').TimelineTrack,
  'id' | 'opacity' | 'blendMode' | 'effects'
> & {
  layer: number;
};

export type WorkerVideoPayloadItem = WorkerTimelineMeta | WorkerTimelineTrack | WorkerTimelineClip;

// ── Runtime validation schemas (worker boundary) ──

const TimelineRangeSchema = z.object({
  startUs: z.number().finite().min(0),
  durationUs: z.number().finite().nonnegative(),
});

const WorkerTimelineClipSchema = z.object({
  kind: z.literal('clip'),
  clipType: z.enum(['media', 'adjustment', 'background', 'text', 'shape', 'hud']),
  id: z.string().min(1),
  trackId: z.string().optional(),
  layer: z.number().int(),
  speed: z.number().finite().optional(),

  audioGain: z.number().optional(),
  audioBalance: z.number().optional(),
  // Clip-only gain/balance, *excluding* the owning track's bus contribution.
  // The native mixer applies the track bus separately (see `audio_tracks`), so
  // the layer must carry only the clip's own value to avoid applying the track
  // gain/balance twice. `audioGain`/`audioBalance` stay the fully-merged values
  // used by the web export mixer (which has no separate bus stage).
  originalAudioGain: z.number().optional(),
  originalAudioBalance: z.number().optional(),
  audioFadeInUs: z.number().optional(),
  audioFadeOutUs: z.number().optional(),
  audioFadeInCurve: FadeCurveSchema.optional(),
  audioFadeOutCurve: FadeCurveSchema.optional(),
  audioDeclickDurationUs: z.number().optional(),
  defaultAudioFadeCurve: FadeCurveSchema.optional(),

  source: z.object({ path: z.string() }).optional(),
  backgroundColor: z.string().optional(),
  text: z.string().optional(),
  style: TextClipStyleSchema.optional(),
  shapeType: ShapeTypeSchema.optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  shapeConfig: ShapeConfigSchema.optional(),
  hudType: HudTypeSchema.optional(),
  background: HudMediaParamsSchema.optional(),
  content: HudMediaParamsSchema.optional(),
  frame: HudMediaParamsSchema.optional(),

  freezeFrameSourceUs: z.number().optional(),
  opacity: z.number().optional(),
  blendMode: BlendModeSchema.optional(),
  effects: z.array(ClipEffectSchema).optional(),
  mask: ClipMaskSchema.optional(),
  transform: ClipTransformSchema.optional(),
  animations: ClipAnimationsSchema.optional(),
  sourceOrientation: ClipSourceOrientationSchema.optional(),
  transitionIn: ClipTransitionSchema.optional(),
  transitionOut: ClipTransitionSchema.optional(),
  sourceDurationUs: z.number().optional(),
  snapToPixelGrid: z.boolean().optional(),

  timelineRange: TimelineRangeSchema,
  sourceRange: TimelineRangeSchema,
});

const WorkerTimelineTrackSchema = z.object({
  kind: z.literal('track'),
  id: z.string().min(1),
  layer: z.number().int(),
  opacity: z.number().optional(),
  blendMode: BlendModeSchema.optional(),
  effects: z.array(ClipEffectSchema).optional(),
});

const WorkerTimelineMetaSchema = z.object({
  kind: z.literal('meta'),
  masterEffects: z.array(ClipEffectSchema),
});

export type WorkerTimelineClip = z.infer<typeof WorkerTimelineClipSchema>;
export type WorkerTimelineTrack = z.infer<typeof WorkerTimelineTrackSchema>;
export type WorkerTimelineMeta = z.infer<typeof WorkerTimelineMetaSchema>;

export const WorkerVideoPayloadItemSchema = z.union([
  WorkerTimelineClipSchema,
  WorkerTimelineTrackSchema,
  WorkerTimelineMetaSchema,
]);

export const WorkerVideoPayloadSchema = z.array(WorkerVideoPayloadItemSchema);

export function parseWorkerVideoPayload(value: unknown): WorkerVideoPayloadItem[] {
  return WorkerVideoPayloadSchema.parse(value) as WorkerVideoPayloadItem[];
}
