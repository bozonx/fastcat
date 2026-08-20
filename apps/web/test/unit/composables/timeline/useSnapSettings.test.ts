import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';

import { useSnapSettings } from '~/composables/timeline/useSnapSettings';

const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: {
      snapThresholdPx: 8,
      snapping: {
        timelineEdges: true,
        clips: true,
        markers: true,
        selection: true,
        playhead: true,
        playheadClick: true,
      },
    },
  },
});

const mockSettingsStore = reactive({
  toolbarSnapMode: 'snap' as 'snap' | 'no_snap',
  setGlobalSnapThresholdPx: vi.fn((val: number) => {
    mockWorkspaceStore.userSettings.timeline.snapThresholdPx = val;
  }),
  selectToolbarSnapMode: vi.fn((mode: 'snap' | 'no_snap') => {
    mockSettingsStore.toolbarSnapMode = mode;
  }),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => mockSettingsStore,
}));

describe('useSnapSettings', () => {
  beforeEach(() => {
    mockSettingsStore.toolbarSnapMode = 'snap';
    mockWorkspaceStore.userSettings.timeline.snapThresholdPx = 8;
    Object.assign(mockWorkspaceStore.userSettings.timeline.snapping, {
      timelineEdges: true,
      clips: true,
      markers: true,
      selection: true,
      playhead: true,
      playheadClick: true,
    });
    vi.clearAllMocks();
  });

  it('returns snap mode options with expected values', () => {
    const { snapModeOptions, currentSnapOption } = useSnapSettings();

    expect(snapModeOptions.value).toHaveLength(2);
    expect(snapModeOptions.value[0]!.value).toBe('snap');
    expect(snapModeOptions.value[1]!.value).toBe('no_snap');
    expect(currentSnapOption.value.value).toBe('snap');
  });

  it('reflects snap enabled state', () => {
    const { isSnapEnabled } = useSnapSettings();
    expect(isSnapEnabled.value).toBe(true);

    mockSettingsStore.toolbarSnapMode = 'no_snap';
    expect(isSnapEnabled.value).toBe(false);
  });

  it('updates snap threshold via store', () => {
    const { snapThresholdPx } = useSnapSettings();
    snapThresholdPx.value = 24;

    expect(mockSettingsStore.setGlobalSnapThresholdPx).toHaveBeenCalledWith(24);
    expect(mockWorkspaceStore.userSettings.timeline.snapThresholdPx).toBe(24);
  });

  it('updates snapping target flags via workspace settings', () => {
    const { snapToClips, snapToMarkers } = useSnapSettings();

    snapToClips.value = false;
    snapToMarkers.value = false;

    expect(mockWorkspaceStore.userSettings.timeline.snapping.clips).toBe(false);
    expect(mockWorkspaceStore.userSettings.timeline.snapping.markers).toBe(false);
  });
});
