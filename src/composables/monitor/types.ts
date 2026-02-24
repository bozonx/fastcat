export interface WorkerTimelineClip {
  kind: 'clip';
  clipType: 'media' | 'adjustment' | 'background';
  id: string;
  layer: number;
  source?: {
    path: string;
  };
  backgroundColor?: string;
  freezeFrameSourceUs?: number;
  opacity?: number;
  effects?: unknown[];
  timelineRange: {
    startUs: number;
    durationUs: number;
  };
  sourceRange: {
    startUs: number;
    durationUs: number;
  };
}
