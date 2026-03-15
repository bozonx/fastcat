export interface MonitorScrubPreviewState {
  lastScrubPreviewAtMs: number;
}

export interface CanPlayMonitorScrubPreviewParams {
  fromUs: number;
  toUs: number;
  state: MonitorScrubPreviewState;
  isUnmounted: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  hasLoadError: boolean;
  minDeltaUs: number;
  maxDeltaUs: number;
  throttleMs: number;
  nowMs?: number;
}

export function canPlayMonitorScrubPreview(params: CanPlayMonitorScrubPreviewParams): boolean {
  if (params.isUnmounted || params.isPlaying || params.isLoading || params.hasLoadError) {
    return false;
  }

  const deltaUs = params.toUs - params.fromUs;
  if (deltaUs < params.minDeltaUs || deltaUs > params.maxDeltaUs) {
    return false;
  }

  const now = params.nowMs ?? performance.now();
  if (now - params.state.lastScrubPreviewAtMs < params.throttleMs) {
    return false;
  }

  params.state.lastScrubPreviewAtMs = now;
  return true;
}
