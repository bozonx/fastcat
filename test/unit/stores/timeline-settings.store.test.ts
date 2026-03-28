import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { DEFAULT_SNAP_SETTINGS } from '~/utils/timeline-modes';

// Mock localStorage via @vueuse/core if needed, but here useLocalStorage might just work with mocked window.localStorage from vitest.setup.ts
// However, workspace.store and timeline.store need mocks.

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: {
      timeline: {
        snapThresholdPx: 10,
      },
    },
  }),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({}),
}));

describe('useTimelineSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initializes with default snap settings', () => {
    const store = useTimelineSettingsStore();
    expect(store.overlapMode).toBe(DEFAULT_SNAP_SETTINGS.overlapMode);
    expect(store.frameSnapMode).toBe(DEFAULT_SNAP_SETTINGS.frameSnapMode);
    expect(store.clipSnapMode).toBe(DEFAULT_SNAP_SETTINGS.clipSnapMode);
  });

  it('sets overlap mode', () => {
    const store = useTimelineSettingsStore();
    store.setOverlapMode('pseudo');
    expect(store.overlapMode).toBe('pseudo');
  });

  it('sets frame snap mode', () => {
    const store = useTimelineSettingsStore();
    store.setFrameSnapMode('free');
    expect(store.frameSnapMode).toBe('free');
  });

  it('cycles toolbar snap mode', () => {
    const store = useTimelineSettingsStore();
    // starts at 'snap'
    expect(store.toolbarSnapMode).toBe('snap');
    store.cycleToolbarSnapMode();
    expect(store.toolbarSnapMode).toBe('no_snap');
    store.cycleToolbarSnapMode();
    expect(store.toolbarSnapMode).toBe('free_mode');
    store.cycleToolbarSnapMode();
    expect(store.toolbarSnapMode).toBe('snap');
  });

  it('selects toolbar drag mode', () => {
    const store = useTimelineSettingsStore();
    store.selectToolbarDragMode('copy');
    expect(store.toolbarDragMode).toBe('copy');
    expect(store.toolbarDragModeEnabled).toBe(true);
  });

  it('toggles selected toolbar drag mode', () => {
    const store = useTimelineSettingsStore();
    store.toolbarDragModeEnabled = false;
    store.toggleSelectedToolbarDragMode();
    expect(store.toolbarDragModeEnabled).toBe(true);
    store.toggleSelectedToolbarDragMode();
    expect(store.toolbarDragModeEnabled).toBe(false);
  });

  it('computes snap threshold from workspace settings', () => {
    const store = useTimelineSettingsStore();
    expect(store.snapThresholdPx).toBe(10);
  });
});
