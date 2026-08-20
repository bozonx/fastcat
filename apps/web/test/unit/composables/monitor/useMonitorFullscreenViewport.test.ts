import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';

import { useMonitorFullscreenViewport } from '~/composables/monitor/useMonitorFullscreenViewport';

function createMockProjectStore() {
  return reactive({
    activeMonitor: { zoom: 1, panX: 0, panY: 0 },
  }) as unknown as { activeMonitor: { zoom: number; panX: number; panY: number } };
}

describe('useMonitorFullscreenViewport', () => {
  it('captures active monitor zoom and pan', () => {
    const projectStore = createMockProjectStore();
    projectStore.activeMonitor.zoom = 2.5;
    projectStore.activeMonitor.panX = 10;
    projectStore.activeMonitor.panY = 20;

    const { capturePanelViewport, savedPanelViewport } = useMonitorFullscreenViewport(
      projectStore as never,
    );

    capturePanelViewport();

    expect(savedPanelViewport.value).toEqual({ zoom: 2.5, panX: 10, panY: 20 });
  });

  it('does not overwrite an already saved viewport', () => {
    const projectStore = createMockProjectStore();
    projectStore.activeMonitor.zoom = 2;

    const { capturePanelViewport, savedPanelViewport } = useMonitorFullscreenViewport(
      projectStore as never,
    );

    capturePanelViewport();
    const firstSnapshot = savedPanelViewport.value;

    projectStore.activeMonitor.zoom = 3;
    capturePanelViewport();

    expect(savedPanelViewport.value).toBe(firstSnapshot);
  });

  it('restores active monitor zoom and pan', () => {
    const projectStore = createMockProjectStore();
    projectStore.activeMonitor.zoom = 2.5;
    projectStore.activeMonitor.panX = 10;
    projectStore.activeMonitor.panY = 20;

    const { capturePanelViewport, restorePanelViewport } = useMonitorFullscreenViewport(
      projectStore as never,
    );

    capturePanelViewport();
    projectStore.activeMonitor.zoom = 1;
    projectStore.activeMonitor.panX = 0;
    projectStore.activeMonitor.panY = 0;

    restorePanelViewport();

    expect(projectStore.activeMonitor).toEqual({ zoom: 2.5, panX: 10, panY: 20 });
  });

  it('does nothing when restoring without a saved snapshot', () => {
    const projectStore = createMockProjectStore();
    projectStore.activeMonitor.zoom = 1.5;

    const { restorePanelViewport } = useMonitorFullscreenViewport(projectStore as never);

    restorePanelViewport();

    expect(projectStore.activeMonitor.zoom).toBe(1.5);
  });
});
