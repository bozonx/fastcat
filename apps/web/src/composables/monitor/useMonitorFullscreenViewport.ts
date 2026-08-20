import { ref } from 'vue';
import type { Ref } from 'vue';
import type { useProjectStore } from '~/stores/project.store';

export interface MonitorViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface UseMonitorFullscreenViewportReturn {
  savedPanelViewport: Ref<MonitorViewportState | null>;
  capturePanelViewport: () => void;
  restorePanelViewport: () => void;
}

export function useMonitorFullscreenViewport(
  projectStore: ReturnType<typeof useProjectStore>,
): UseMonitorFullscreenViewportReturn {
  const savedPanelViewport = ref<MonitorViewportState | null>(null);

  function capturePanelViewport() {
    if (savedPanelViewport.value) return;
    const m = projectStore.activeMonitor;
    if (!m) return;
    savedPanelViewport.value = { zoom: m.zoom, panX: m.panX, panY: m.panY };
  }

  function restorePanelViewport() {
    const m = projectStore.activeMonitor;
    const s = savedPanelViewport.value;
    if (!m || !s) return;
    m.zoom = s.zoom;
    m.panX = s.panX;
    m.panY = s.panY;
    savedPanelViewport.value = null;
  }

  return { savedPanelViewport, capturePanelViewport, restorePanelViewport };
}
