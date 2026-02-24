export interface WorkerTimelineClip {
  kind: 'clip';
  id: string;
  layer: number;
  source: {
    path: string;
  };
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
