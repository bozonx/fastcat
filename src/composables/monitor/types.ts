export interface WorkerTimelineClip {
  kind: 'clip';
  clipType: 'media' | 'adjustment' | 'background';
  id: string;
  layer: number;
  speed?: number;
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
