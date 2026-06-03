import type {
  ClipTransform,
  ClipEffect,
  TimelineBlendMode,
  ClipSourceOrientation,
} from '~/timeline/types';

import { z } from 'zod';

export const ExportOptionsSchema = z.object({
  format: z.enum(['mp4', 'webm', 'mkv', 'aac', 'opus', 'ogg', 'flac', 'wav', 'pcm']),
  videoCodec: z.string().trim().min(1),
  bitrate: z.number().finite().min(1),
  bitrateMode: z.enum(['constant', 'variable']).optional(),
  keyframeIntervalSec: z.number().finite().positive().max(1_000).optional(),
  exportAlpha: z.boolean().optional(),
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
  format: z.enum(['mp4', 'webm', 'mkv', 'aac', 'opus', 'ogg', 'flac', 'wav', 'pcm']),
  videoCodec: z.string().trim().min(1),
  bitrate: z.number().finite().min(1),
  bitrateMode: z.enum(['constant', 'variable']).optional(),
  keyframeIntervalSec: z.number().finite().positive().max(1_000).optional(),
  exportAlpha: z.boolean().optional(),
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
export interface WorkerTimelineClip {
  kind: 'clip';
  clipType: 'media' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
  id: string;
  trackId?: string;
  layer: number;
  speed?: number;

  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  audioFadeInCurve?: 'linear' | 'logarithmic';
  audioFadeOutCurve?: 'linear' | 'logarithmic';
  audioDeclickDurationUs?: number;
  defaultAudioFadeCurve?: 'linear' | 'logarithmic';
  source?: { path: string };
  backgroundColor?: string;
  text?: string;
  style?: import('~/timeline/types').TextClipStyle;
  shapeType?: 'square' | 'circle' | 'triangle' | 'star' | 'cloud' | 'speech_bubble' | 'bang';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shapeConfig?: import('~/timeline/types').ShapeConfig;
  hudType?: 'media_frame';
  background?: import('~/timeline/types').HudMediaParams;
  content?: import('~/timeline/types').HudMediaParams;
  frame?: import('~/timeline/types').HudMediaParams;
  freezeFrameSourceUs?: number;
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: ClipEffect[];
  mask?: import('~/timeline/types').ClipMask;
  transform?: ClipTransform;
  sourceOrientation?: ClipSourceOrientation;
  transitionIn?: import('~/timeline/types').ClipTransition;
  transitionOut?: import('~/timeline/types').ClipTransition;
  sourceDurationUs?: number;
  timelineRange: { startUs: number; durationUs: number };
  sourceRange: { startUs: number; durationUs: number };
}

export interface WorkerTimelineTrack {
  kind: 'track';
  id: string;
  layer: number;
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: ClipEffect[];
}

export interface WorkerTimelineMeta {
  kind: 'meta';
  masterEffects: ClipEffect[];
}

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
  audioFadeInUs: z.number().optional(),
  audioFadeOutUs: z.number().optional(),
  audioFadeInCurve: z.enum(['linear', 'logarithmic']).optional(),
  audioFadeOutCurve: z.enum(['linear', 'logarithmic']).optional(),
  audioDeclickDurationUs: z.number().optional(),
  defaultAudioFadeCurve: z.enum(['linear', 'logarithmic']).optional(),

  source: z.object({ path: z.string() }).optional(),
  backgroundColor: z.string().optional(),
  text: z.string().optional(),
  style: z.unknown().optional(),
  shapeType: z.string().optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(),
  shapeConfig: z.unknown().optional(),
  hudType: z.string().optional(),
  background: z.unknown().optional(),
  content: z.unknown().optional(),
  frame: z.unknown().optional(),

  freezeFrameSourceUs: z.number().optional(),
  opacity: z.number().optional(),
  blendMode: z.string().optional(),
  effects: z.array(z.unknown()).optional(),
  mask: z.unknown().optional(),
  transform: z.unknown().optional(),
  sourceOrientation: z.unknown().optional(),
  transitionIn: z.unknown().optional(),
  transitionOut: z.unknown().optional(),
  sourceDurationUs: z.number().optional(),

  timelineRange: TimelineRangeSchema,
  sourceRange: TimelineRangeSchema,
});

const WorkerTimelineTrackSchema = z.object({
  kind: z.literal('track'),
  id: z.string().min(1),
  layer: z.number().int(),
  opacity: z.number().optional(),
  blendMode: z.string().optional(),
  effects: z.array(z.unknown()).optional(),
});

const WorkerTimelineMetaSchema = z.object({
  kind: z.literal('meta'),
  masterEffects: z.array(z.unknown()),
});

export const WorkerVideoPayloadItemSchema = z.union([
  WorkerTimelineClipSchema,
  WorkerTimelineTrackSchema,
  WorkerTimelineMetaSchema,
]);

export const WorkerVideoPayloadSchema = z.array(WorkerVideoPayloadItemSchema);

export function parseWorkerVideoPayload(value: unknown): WorkerVideoPayloadItem[] {
  return WorkerVideoPayloadSchema.parse(value);
}
