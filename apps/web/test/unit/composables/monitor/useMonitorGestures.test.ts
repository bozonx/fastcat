/** @vitest-environment happy-dom */
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

  it('handles left double click based on shared viewer settings', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.leftDoubleClick = 'reset_zoom_center';
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

  it('returns fullscreen for default left double click action', () => {
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    expect(gestures.onViewportDoubleClick({ button: 0 } as MouseEvent)).toBe('fullscreen');
  });

  it('uses middle double click action for aux double click', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.middleDoubleClick = 'reset_zoom_center';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.panX = 50;
    gestures.onViewportAuxClick({
      button: 1,
      detail: 2,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);

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

  it('handles middle click "fit" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.middleClick = 'fit';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    vi.spyOn(viewportEl.value, 'clientWidth', 'get').mockReturnValue(960);
    vi.spyOn(viewportEl.value, 'clientHeight', 'get').mockReturnValue(540);

    projectStore.activeMonitor.zoom = 3;
    gestures.onViewportAuxClick({
      button: 1,
      detail: 1,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);

    expect(projectStore.activeMonitor.zoom).toBeLessThan(3);
    expect(projectStore.activeMonitor.panX).toBe(0);
  });

  it('handles middle click "center" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.middleClick = 'center';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.panX = 50;
    projectStore.activeMonitor.panY = 30;
    gestures.onViewportAuxClick({
      button: 1,
      detail: 1,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);

    expect(projectStore.activeMonitor.panX).toBe(0);
    expect(projectStore.activeMonitor.panY).toBe(0);
  });

  it('handles middle click "reset_zoom" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.middleClick = 'reset_zoom';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.zoom = 2.5;
    gestures.onViewportAuxClick({
      button: 1,
      detail: 1,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);

    expect(projectStore.activeMonitor.zoom).toBe(1);
  });

  it('handles middle click "none" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.middleClick = 'none';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.zoom = 2;
    gestures.onViewportAuxClick({
      button: 1,
      detail: 1,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);

    expect(projectStore.activeMonitor.zoom).toBe(2);
  });

  it('ignores non-middle-button aux clicks', () => {
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.zoom = 2;
    gestures.onViewportAuxClick({
      button: 0,
      detail: 1,
      preventDefault: vi.fn(),
    } as unknown as MouseEvent);

    expect(projectStore.activeMonitor.zoom).toBe(2);
  });

  it('handles left double click "fit" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.leftDoubleClick = 'fit';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    vi.spyOn(viewportEl.value, 'clientWidth', 'get').mockReturnValue(960);
    vi.spyOn(viewportEl.value, 'clientHeight', 'get').mockReturnValue(540);

    projectStore.activeMonitor.zoom = 3;
    const result = gestures.onViewportDoubleClick({ button: 0 } as MouseEvent);

    expect(result).toBeUndefined();
    expect(projectStore.activeMonitor.zoom).toBeLessThan(3);
  });

  it('handles left double click "reset_zoom" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.leftDoubleClick = 'reset_zoom';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.zoom = 2.5;
    gestures.onViewportDoubleClick({ button: 0 } as MouseEvent);

    expect(projectStore.activeMonitor.zoom).toBe(1);
  });

  it('handles left double click "center" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.leftDoubleClick = 'center';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    projectStore.activeMonitor.panX = 40;
    projectStore.activeMonitor.panY = 20;
    gestures.onViewportDoubleClick({ button: 0 } as MouseEvent);

    expect(projectStore.activeMonitor.panX).toBe(0);
    expect(projectStore.activeMonitor.panY).toBe(0);
  });

  it('ignores non-primary button on double click', () => {
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    const result = gestures.onViewportDoubleClick({ button: 2 } as MouseEvent);
    expect(result).toBeUndefined();
  });

  it('handles wheel "scroll_vertical" action via shift modifier', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.wheelShift = 'scroll_vertical';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    const initialPanY = projectStore.activeMonitor.panY;
    const preventSpy = vi.fn();
    // With shiftKey, the action comes from wheelShift and bypasses native scroll
    gestures.onViewportWheel({
      deltaY: 50,
      clientX: 500,
      clientY: 250,
      preventDefault: preventSpy,
      ctrlKey: false,
      shiftKey: true,
    } as unknown as WheelEvent);

    expect(preventSpy).toHaveBeenCalled();
    expect(projectStore.activeMonitor.panY).not.toBe(initialPanY);
  });

  it('handles wheel "scroll_horizontal" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.wheel = 'scroll_horizontal';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    const initialPanX = projectStore.activeMonitor.panX;
    gestures.onViewportWheel({
      deltaY: 50,
      clientX: 500,
      clientY: 250,
      preventDefault: vi.fn(),
      ctrlKey: false,
      shiftKey: false,
    } as unknown as WheelEvent);

    expect(projectStore.activeMonitor.panX).not.toBe(initialPanX);
  });

  it('handles wheel "none" action', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.wheel = 'none';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    const initialZoom = projectStore.activeMonitor.zoom;
    const preventSpy = vi.fn();
    gestures.onViewportWheel({
      deltaY: 50,
      clientX: 500,
      clientY: 250,
      preventDefault: preventSpy,
      ctrlKey: false,
      shiftKey: false,
    } as unknown as WheelEvent);

    expect(preventSpy).toHaveBeenCalled();
    expect(projectStore.activeMonitor.zoom).toBe(initialZoom);
  });

  it('handles ctrl+wheel as pinch-to-zoom regardless of settings', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.wheel = 'none';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    vi.spyOn(viewportEl.value, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 500,
      left: 0,
      top: 0,
    } as DOMRect);

    const initialZoom = projectStore.activeMonitor.zoom;
    gestures.onViewportWheel({
      deltaY: -100,
      clientX: 500,
      clientY: 250,
      preventDefault: vi.fn(),
      ctrlKey: true,
      shiftKey: false,
    } as unknown as WheelEvent);

    expect(projectStore.activeMonitor.zoom).toBeGreaterThan(initialZoom);
  });

  it('handles middle drag pan for middleDrag="pan"', () => {
    mockWorkspaceStore.userSettings.mouse.monitor.middleDrag = 'pan';
    const gestures = useMonitorGestures({
      projectStore,
      viewportEl,
      renderWidth: ref(1920),
      renderHeight: ref(1080),
    });

    gestures.onViewportPointerDown({
      button: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 9,
      pointerType: 'mouse',
      currentTarget: viewportEl.value,
      preventDefault: vi.fn(),
    } as unknown as PointerEvent);

    // Call onViewportPointerMove directly (component would bind it)
    gestures.onViewportPointerMove({
      clientX: 150,
      clientY: 120,
      pointerId: 9,
      pointerType: 'mouse',
    } as unknown as PointerEvent);

    expect(projectStore.activeMonitor.panX).not.toBe(0);
    expect(projectStore.activeMonitor.panY).not.toBe(0);
  });
});
