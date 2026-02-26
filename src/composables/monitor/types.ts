export interface WorkerTimelineClip {
  kind: 'clip';
  clipType: 'media' | 'adjustment' | 'background' | 'text';
  id: string;
  layer: number;
  speed?: number;
  audioGain?: number;
  audioBalance?: number;
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  transitionIn?: {
    type: string;
    durationUs: number;
  };
  transitionOut?: {
    type: string;
    durationUs: number;
  };
  source?: {
    path: string;
  };
  backgroundColor?: string;
  text?: string;
  style?: import('~/timeline/types').TextClipStyle;
  freezeFrameSourceUs?: number;
  opacity?: number;
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
