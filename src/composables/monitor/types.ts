export interface WorkerTimelineClip {
  kind: 'clip';
  id: string;
  source: {
    path: string;
  };
  timelineRange: {
    startUs: number;
    durationUs: number;
  };
  sourceRange: {
    startUs: number;
    durationUs: number;
  };
}
