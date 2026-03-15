export interface MonitorPlaybackLoopState {
  lastFrameTimeMs: number;
  renderAccumulatorMs: number;
  storeSyncAccumulatorMs: number;
  audioLevelsAccumulatorMs: number;
}

export function resetMonitorPlaybackLoopState(state: MonitorPlaybackLoopState) {
  state.lastFrameTimeMs = 0;
  state.renderAccumulatorMs = 0;
  state.storeSyncAccumulatorMs = 0;
  state.audioLevelsAccumulatorMs = 0;
}

export function advanceMonitorPlaybackLoop(params: {
  timestamp: number;
  state: MonitorPlaybackLoopState;
}) {
  const deltaMsRaw = params.timestamp - params.state.lastFrameTimeMs;
  const deltaMs = Number.isFinite(deltaMsRaw) && deltaMsRaw > 0 ? deltaMsRaw : 0;

  params.state.lastFrameTimeMs = params.timestamp;
  params.state.renderAccumulatorMs += deltaMs;
  params.state.storeSyncAccumulatorMs += deltaMs;
  params.state.audioLevelsAccumulatorMs += deltaMs;

  return {
    deltaMs,
    renderAccumulatorMs: params.state.renderAccumulatorMs,
    storeSyncAccumulatorMs: params.state.storeSyncAccumulatorMs,
    audioLevelsAccumulatorMs: params.state.audioLevelsAccumulatorMs,
  };
}
