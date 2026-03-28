import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref, reactive } from 'vue';
import { useMonitorGestures } from '~/composables/monitor/useMonitorGestures';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

// Mock dependencies
const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({
    monitorZoomTrigger: { timestamp: 0, dir: 0 },
    monitorZoomResetTrigger: 0,
    monitorZoomFitTrigger: 0,
  }),
}));

describe('useMonitorGestures', () => {
  let projectStore: any;
  let viewportEl: any;

  beforeEach(() => {
    projectStore = {
      activeMonitor: reactive({
        panX: 0,
        panY: 0,
        zoom: 1,
      }),
    };
    viewportEl = ref(document.createElement('div'));
    mockWorkspaceStore.userSettings = reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)));
  });

  it('resets view correctly', () => {
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.panX = 100;
    projectStore.activeMonitor.zoom = 2;
    gestures.resetView();

    expect(projectStore.activeMonitor.panX).toBe(0);
    expect(projectStore.activeMonitor.zoom).toBe(1);
  });

  it('handles double click based on settings', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.doubleClick = 'reset_zoom_center';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.panX = 50;
    gestures.onViewportDoubleClick({ button: 0 } as MouseEvent);
    expect(projectStore.activeMonitor.panX).toBe(0);
  });

  it('handles wheel zoom based on settings', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.wheel = 'zoom';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    const initialZoom = projectStore.activeMonitor.zoom;
    // We need to mock getBoundingClientRect for applyZoomAtPoint
    vi.spyOn(viewportEl.value, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 500,
      left: 0,
      top: 0,
    } as DOMRect);

    gestures.onViewportWheel({
      deltaY: -100,
      clientX: 500,
      clientY: 250,
      preventDefault: vi.fn(),
      ctrlKey: false,
      shiftKey: false,
    } as unknown as WheelEvent);

    expect(projectStore.activeMonitor.zoom).toBeGreaterThan(initialZoom);
  });
});
