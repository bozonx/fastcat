import type {
  ClipTransform,
  ClipEffect,
  TimelineSelectionRange,
  TimelineBlendMode,
} from '~/timeline/types';

import { z } from 'zod';

export const ExportOptionsSchema = z.object({
  format: z.enum(['mp4', 'webm', 'mkv']),
  videoCodec: z.string(),
  bitrate: z.number(),
  bitrateMode: z.enum(['constant', 'variable']).optional(),
  keyframeIntervalSec: z.number().optional(),
  exportAlpha: z.boolean().optional(),
  metadata: z
    .object({
      title: z.string(),
      description: z.string(),
      author: z.string(),
      tags: z.string(),
    })
    .optional(),
  audioBitrate: z.number(),
  audio: z.boolean(),
  audioCodec: z.string().optional(),
  audioSampleRate: z.number().optional(),
  audioChannels: z.enum(['stereo', 'mono']).optional(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  audioReverse: z.boolean().optional(),
  audioDurationSec: z.number().optional(),
  exportRangeUs: z.object({ startUs: z.number(), endUs: z.number() }).optional(),
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
  freezeFrameSourceUs?: number;
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: ClipEffect[];
  mask?: import('~/timeline/types').ClipMask;
  transform?: ClipTransform;
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
