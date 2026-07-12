import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';

const { openNativeWindowMock, addMarkerMock } = vi.hoisted(() => ({
  openNativeWindowMock: vi.fn(async () => undefined),
  addMarkerMock: vi.fn(),
}));

const mockActiveMonitor = {
  toolbarPosition: 'bottom',
  previewResolution: 1,
  previewBlurQuality: 'auto' as 'auto' | 'low' | 'medium' | 'high' | 'ultra',
  previewEffectsEnabled: true,
  useProxy: false,
};

const mockWorkspaceStore = {
  userSettings: {
    optimization: {
      nativeMonitorSyncMode: 'balanced' as 'balanced' | 'smooth' | 'strict',
    },
  },
};

vi.mock('~/composables/monitor/native-monitor-ipc', () => ({
  nativeMonitorIpc: {
    openNativeWindow: () => openNativeWindowMock(),
  },
}));

vi.mock('~/composables/monitor/useMonitorSettings', () => ({
  useMonitorSettings: () => ({
    showTimecode: ref(true),
    showTransparencyGrid: ref(false),
    showMarkerTexts: ref(true),
  }),
}));

function createControls(options: { isMobile?: boolean } = {}) {
  return useMonitorContainerControls({
    t: (key: string) => key,
    projectStore: {
      activeMonitor: mockActiveMonitor,
    } as never,
    workspaceStore: mockWorkspaceStore as never,
    timelineStore: {
      playbackSpeed: 1,
      currentTime: 5000,
      markers: [],
      timelineFormat: {
        height: 1080,
      },
      setPlaybackSpeed: vi.fn(),
      togglePlayback: vi.fn(),
      setCurrentTimeUs: vi.fn(),
      requestScrollToPlayhead: vi.fn(),
      jumpToNextClipBoundary: vi.fn(),
      jumpToPrevClipBoundary: vi.fn(),
      addMarkerAtPlayhead: vi.fn(),
      addMarker: addMarkerMock,
    } as never,
    selectionStore: {
      selectTimelineMarker: vi.fn(),
    } as never,
    viewportRef: ref(null),
    videoItems: ref([]),
    isLoading: ref(false),
    loadError: ref(null),
    safeDurationUs: ref(0),
    previewEffectsEnabled: ref(true),
    useProxyInMonitor: ref(false),
    showGrid: ref(false),
    isSavingStopFrame: ref(false),
    createStopFrameSnapshot: vi.fn(async () => undefined),
    scheduleBuild: vi.fn(),
    toggleGrid: vi.fn(),
    isMobile: options.isMobile,
  });
}

interface MenuItem {
  label?: string;
  type?: string;
  onSelect?: () => void;
  children?: MenuItem[];
}

function flattenMenuItems(groups: unknown[][]): MenuItem[] {
  const result: MenuItem[] = [];
  function traverse(item: MenuItem) {
    result.push(item);
    if (item.children) {
      for (const child of item.children) {
        traverse(child);
      }
    }
  }
  for (const group of groups) {
    for (const item of group as MenuItem[]) {
      traverse(item);
    }
  }
  return result;
}

describe('useMonitorContainerControls', () => {
  beforeEach(() => {
    openNativeWindowMock.mockClear();
    addMarkerMock.mockClear();
    mockActiveMonitor.previewBlurQuality = 'auto';
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('adds a Tauri context-menu action that opens the native monitor window', () => {
    const controls = createControls();
    const items = flattenMenuItems(controls.contextMenuItems.value);
    const item = items.find((entry) => entry.label === 'fastcat.monitor.openNativeMonitor');

    expect(item).toBeTruthy();
    item?.onSelect?.();

    expect(openNativeWindowMock).toHaveBeenCalledTimes(1);
  });

  it('does not show the native monitor window action outside Tauri', () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');

    const controls = createControls();
    const items = flattenMenuItems(controls.contextMenuItems.value);

    expect(items.some((entry) => entry.label === 'fastcat.monitor.openNativeMonitor')).toBe(false);
  });

  it('includes showMarkerTexts option in context menu', () => {
    const controls = createControls();
    const items = flattenMenuItems(controls.contextMenuItems.value);
    const item = items.find((entry) => entry.label === 'fastcat.monitor.showMarkerTexts');

    expect(item).toBeTruthy();
    expect(item?.type).toBe('checkbox');
  });

  it('updates preview blur quality from the context menu', () => {
    const controls = createControls();
    const items = flattenMenuItems(controls.contextMenuItems.value);
    const highQuality = items.find(
      (entry) => entry.label === 'fastcat.timeline.transition.blurQualityHigh',
    );

    expect(highQuality).toBeTruthy();
    highQuality?.onSelect?.();

    expect(mockActiveMonitor.previewBlurQuality).toBe('high');
    expect(items.some((entry) => entry.label?.includes('fastcat.monitor.previewBlurQuality'))).toBe(
      true,
    );
  });

  it('hides addMarkerWithText option in context menu if isMobile is true', () => {
    const controls = createControls({ isMobile: true });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label === 'fastcat.timeline.addMarkerWithText')).toBe(
      false,
    );
  });

  it('shows addMarkerWithText option in context menu if isMobile is false or undefined', () => {
    const controls = createControls({ isMobile: false });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label === 'fastcat.timeline.addMarkerWithText')).toBe(
      true,
    );
  });

  it('hides playbackSpeed selection option in context menu if isMobile is true', () => {
    const controls = createControls({ isMobile: true });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label?.includes('fastcat.monitor.playbackSpeed'))).toBe(
      false,
    );
  });

  it('shows playbackSpeed selection option in context menu if isMobile is false or undefined', () => {
    const controls = createControls({ isMobile: false });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label?.includes('fastcat.monitor.playbackSpeed'))).toBe(
      true,
    );
  });

  it('includes toolbar position sub-menu and updates state', () => {
    mockActiveMonitor.toolbarPosition = 'bottom';
    const controls = createControls({ isMobile: false });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    const topItem = items.find((entry) => entry.label === 'fastcat.monitor.toolbarTop');
    expect(topItem).toBeTruthy();
    topItem?.onSelect?.();
    expect(mockActiveMonitor.toolbarPosition).toBe('top');
  });

  it('includes sync mode sub-menu and updates state', () => {
    mockWorkspaceStore.userSettings.optimization.nativeMonitorSyncMode = 'balanced';
    const controls = createControls({ isMobile: false });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    const smoothItem = items.find((entry) => entry.label === 'fastcat.monitor.syncSmooth');
    expect(smoothItem).toBeTruthy();
    smoothItem?.onSelect?.();
    expect(mockWorkspaceStore.userSettings.optimization.nativeMonitorSyncMode).toBe('smooth');
  });

  it('includes preview resolution sub-menu and updates state', () => {
    mockActiveMonitor.previewResolution = 1;
    const controls = createControls({ isMobile: false });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    const halfOption = items.find((entry) => entry.label === '1/2 (540p)');
    expect(halfOption).toBeTruthy();
    halfOption?.onSelect?.();
    expect(mockActiveMonitor.previewResolution).toBe(0.5);
  });

  it('creates marker with text at playhead position', () => {
    const controls = createControls();
    controls.createMarkerWithTextAtPlayhead('hello', '#eab308');
    expect(addMarkerMock).toHaveBeenCalledOnce();
    expect(addMarkerMock).toHaveBeenCalledWith({
      timeUs: 5000,
      text: 'hello',
      color: '#eab308',
    });
  });
});
