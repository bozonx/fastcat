import type {
  ClipTransform,
  ClipEffect,
  TimelineSelectionRange,
  TimelineBlendMode,
} from '~/timeline/types';

export interface ExportOptions {
  format: 'mp4' | 'webm' | 'mkv';
  videoCodec: string;
  bitrate: number;
  bitrateMode?: 'constant' | 'variable';
  keyframeIntervalSec?: number;
  exportAlpha?: boolean;
  metadata?: {
    title: string;
    description: string;
    author: string;
    tags: string;
  };
  audioBitrate: number;
  audio: boolean;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: 'stereo' | 'mono';
  width: number;
  height: number;
  fps: number;
  exportRangeUs?: TimelineSelectionRange;
}

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
