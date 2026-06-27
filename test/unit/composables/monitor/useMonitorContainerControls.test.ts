import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

import { useMonitorContainerControls } from '~/composables/monitor/useMonitorContainerControls';

const { openNativeWindowMock } = vi.hoisted(() => ({
  openNativeWindowMock: vi.fn(async () => undefined),
}));

const mockActiveMonitor = {
  toolbarPosition: 'bottom',
  previewResolution: 1,
  previewBlurQuality: 'auto' as 'auto' | 'low' | 'medium' | 'high' | 'ultra',
  previewEffectsEnabled: true,
  useProxy: false,
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
    timelineStore: {
      playbackSpeed: 1,
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

function flattenMenuItems(groups: unknown[][]): Array<{ label?: string; type?: string; onSelect?: () => void }> {
  return groups.flatMap((group) => group as Array<{ label?: string; type?: string; onSelect?: () => void }>);
}

describe('useMonitorContainerControls', () => {
  beforeEach(() => {
    openNativeWindowMock.mockClear();
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
    expect(items.some((entry) => entry.label === 'fastcat.monitor.previewBlurQuality:')).toBe(true);
  });

  it('hides addMarkerAtPlayhead option in context menu if isMobile is true', () => {
    const controls = createControls({ isMobile: true });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label === 'fastcat.timeline.addMarkerAtPlayhead')).toBe(false);
  });

  it('shows addMarkerAtPlayhead option in context menu if isMobile is false or undefined', () => {
    const controls = createControls({ isMobile: false });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label === 'fastcat.timeline.addMarkerAtPlayhead')).toBe(true);
  });

  it('hides playbackSpeed selection option in context menu if isMobile is true', () => {
    const controls = createControls({ isMobile: true });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label === 'fastcat.monitor.playbackSpeed')).toBe(false);
  });

  it('shows playbackSpeed selection option in context menu if isMobile is false or undefined', () => {
    const controls = createControls({ isMobile: false });
    const items = flattenMenuItems(controls.contextMenuItems.value);
    expect(items.some((entry) => entry.label === 'fastcat.monitor.playbackSpeed')).toBe(true);
  });
});
