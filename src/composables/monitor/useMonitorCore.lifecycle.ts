export function initializeMonitorCoreRuntime(params: {
  setUnmounted: (value: boolean) => void;
  updateCanvasDisplaySize: () => void;
  scheduleBuild: () => void;
}) {
  params.setUnmounted(false);
  params.updateCanvasDisplaySize();
  params.scheduleBuild();
}

export function disposeMonitorCoreRuntime(params: {
  setUnmounted: (value: boolean) => void;
  stopPlayback: () => void;
  clearPendingRender: () => void;
  clearQueues: () => void;
  destroyAudioEngine: () => void;
  destroyCompositor: () => Promise<void>;
}) {
  params.setUnmounted(true);
  params.stopPlayback();
  params.clearPendingRender();
  params.clearQueues();

  try {
    params.destroyAudioEngine();
  } catch (error) {
    console.error('[Monitor] Failed to destroy AudioEngine', error);
  }

  void params.destroyCompositor().catch((error) => {
    console.error('[Monitor] Failed to destroy compositor on unmount', error);
  });
}
