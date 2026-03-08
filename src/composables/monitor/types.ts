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
  audioFadeInCurve?: 'linear' | 'logarithmic';
  audioFadeOutCurve?: 'linear' | 'logarithmic';
  transitionIn?: {
    type: string;
    durationUs: number;
    mode?: 'transition' | 'fade';
    curve?: 'linear' | 'bezier';
    params?: Record<string, unknown>;
  };
  transitionOut?: {
    type: string;
    durationUs: number;
    mode?: 'transition' | 'fade';
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
  sourceDurationUs?: number;
  timelineRange: {
    startUs: number;
    durationUs: number;
  };
  sourceRange: {
    startUs: number;
    durationUs: number;
  };
}
