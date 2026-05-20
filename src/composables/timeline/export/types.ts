import type {
  ClipTransform,
  ClipEffect,
  TimelineSelectionRange,
  TimelineBlendMode,
  ClipSourceOrientation,
} from '~/timeline/types';

import { z } from 'zod';

export const ExportOptionsSchema = z.object({
  format: z.enum(['mp4', 'webm', 'mkv']),
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
  audioReverse: z.boolean().optional(),
  audioDurationSec: z.number().finite().positive().optional(),
  exportRangeUs: z
    .object({ startUs: z.number().finite().min(0), endUs: z.number().finite().min(0) })
    .refine((range) => range.endUs > range.startUs)
    .optional(),
  audioPassthrough: z.boolean().optional(),
});

export type ExportOptions = z.infer<typeof ExportOptionsSchema>;
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
