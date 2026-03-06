export interface WorkerTimelineClip {
  kind: 'clip';
  clipType: 'media' | 'adjustment' | 'background' | 'text';
  id: string;
  trackId?: string;
  layer: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  transitionIn?: {
    type: string;
    durationUs: number;
    mode?: 'blend' | 'blend_previous' | 'composite';
    curve?: 'linear' | 'bezier';
    params?: Record<string, unknown>;
  };
  transitionOut?: {
    type: string;
    durationUs: number;
    mode?: 'blend' | 'blend_previous' | 'composite';
    curve?: 'linear' | 'bezier';
    params?: Record<string, unknown>;
  };
  source?: {
    path: string;
  };
  backgroundColor?: string;
  text?: string;
  style?: import('~/timeline/types').TextClipStyle;
  freezeFrameSourceUs?: number;
  opacity?: number;
  blendMode?: import('~/timeline/types').TimelineBlendMode;
  effects?: unknown[];
  transform?: import('~/timeline/types').ClipTransform;
  timelineRange: {
    startUs: number;
    durationUs: number;
  };
  sourceRange: {
    startUs: number;
    durationUs: number;
  };
}
