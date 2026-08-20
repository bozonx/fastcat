import { createDevLogger } from '~/utils/dev-logger';
const log = createDevLogger('useMonitorCore.lifecycle');
export function initializeMonitorCoreRuntime(params: {
  setUnmounted: (value: boolean) => void;
  updateCanvasDisplaySize: () => void;
  scheduleBuild: () => void;
}) {
  params.setUnmounted(false);
  params.updateCanvasDisplaySize();
  params.scheduleBuild();
}

export async function disposeMonitorCoreRuntime(params: {
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
    log.error('[Monitor] Failed to destroy AudioEngine', error);
  }

  await params.destroyCompositor().catch((error) => {
    log.error('[Monitor] Failed to destroy compositor on unmount', error);
  });
}
