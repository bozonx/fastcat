/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createTimelineSelectionModule } from '~/stores/timeline/selection';

vi.mock('~/timeline/commands/utils', () => ({
  getLinkedClipGroupItemIds: vi.fn((_doc, id) => [id]),
}));

const mockDoc = {
  id: 'doc-1',
  tracks: [
    {
      id: 'track-1',
      items: [
        { id: 'clip-1', kind: 'clip', timelineRange: { startUs: 0, durationUs: 1_000_000 } },
        {
          id: 'clip-2',
          kind: 'clip',
          timelineRange: { startUs: 2_000_000, durationUs: 1_000_000 },
        },
        { id: 'gap-1', kind: 'gap', timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 } },
      ],
    },
    {
      id: 'track-2',
      items: [{ id: 'clip-3', kind: 'clip', timelineRange: { startUs: 0, durationUs: 500_000 } }],
    },
  ],
};

function createMockDeps() {
  return {
    timelineDoc: ref<any>(mockDoc),
    currentTime: ref(500_000),
    selectedItemIds: ref<string[]>([]),
    selectedTrackId: ref<string | null>(null),
    selectedTransition: ref<any>(null),
    selectionStore: {
      clearSelection: vi.fn(),
      selectTimelineTrack: vi.fn(),
      selectTimelineItems: vi.fn(),
    },
  };
}

describe('TimelineSelectionModule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clearSelection resets item ids and transition', () => {
    const deps = createMockDeps();
    deps.selectedItemIds.value = ['clip-1'];
    deps.selectedTransition.value = { trackId: 'track-1', itemId: 'clip-1', edge: 'in' };
    const mod = createTimelineSelectionModule(deps);

    mod.clearSelection();
    expect(deps.selectedItemIds.value).toEqual([]);
    expect(deps.selectedTransition.value).toBeNull();
  });

  it('selectTrack sets track and clears items/transition', () => {
    const deps = createMockDeps();
    deps.selectedItemIds.value = ['clip-1'];
    deps.selectedTransition.value = { trackId: 'track-1', itemId: 'clip-1', edge: 'in' };
    const mod = createTimelineSelectionModule(deps);

    mod.selectTrack('track-1');
    expect(deps.selectedTrackId.value).toBe('track-1');
    expect(deps.selectedItemIds.value).toEqual([]);
    expect(deps.selectedTransition.value).toBeNull();
  });

  it('toggleSelection selects a single item', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.toggleSelection('clip-1');
    expect(deps.selectedItemIds.value).toEqual(['clip-1']);
  });

  it('toggleSelection with multi toggles items', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.toggleSelection('clip-1', { multi: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-1']);

    mod.toggleSelection('clip-2', { multi: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-1', 'clip-2']);

    mod.toggleSelection('clip-1', { multi: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-2']);
  });

  it('selectAllClips selects every clip', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectAllClips();
    expect(deps.selectedItemIds.value.sort()).toEqual(['clip-1', 'clip-2', 'clip-3']);
  });

  it('selectAllClipsOnTrack selects only clips on the given track', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectAllClipsOnTrack('track-1');
    expect(deps.selectedItemIds.value.sort()).toEqual(['clip-1', 'clip-2']);
  });

  it('selectAllClipsOnTrack with append merges clips into existing selection', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectAllClipsOnTrack('track-1');
    mod.selectAllClipsOnTrack('track-2', { append: true });
    expect(deps.selectedItemIds.value.sort()).toEqual(['clip-1', 'clip-2', 'clip-3']);
  });

  it('selectClipsRelativeToPlayhead filters by direction', () => {
    const deps = createMockDeps();
    deps.currentTime.value = 1_500_000;
    const mod = createTimelineSelectionModule(deps);

    mod.selectClipsRelativeToPlayhead({ direction: 'left' });
    expect(deps.selectedItemIds.value.sort()).toEqual(['clip-1', 'clip-3']);

    mod.selectClipsRelativeToPlayhead({ direction: 'right' });
    expect(deps.selectedItemIds.value).toEqual(['clip-2']);
  });

  it('getHotkeyTargetClip returns selected clip when available', () => {
    const deps = createMockDeps();
    deps.selectedItemIds.value = ['clip-2'];
    const mod = createTimelineSelectionModule(deps);

    expect(mod.getHotkeyTargetClip()).toEqual({ trackId: 'track-1', itemId: 'clip-2' });
  });

  it('getHotkeyTargetClip falls back to clip under playhead on selected track', () => {
    const deps = createMockDeps();
    deps.selectedTrackId.value = 'track-1';
    deps.currentTime.value = 500_000;
    const mod = createTimelineSelectionModule(deps);

    expect(mod.getHotkeyTargetClip()).toEqual({ trackId: 'track-1', itemId: 'clip-1' });
  });

  it('getSelectedOrActiveTrackId returns track of first selected item', () => {
    const deps = createMockDeps();
    deps.selectedItemIds.value = ['clip-3'];
    const mod = createTimelineSelectionModule(deps);

    expect(mod.getSelectedOrActiveTrackId()).toBe('track-2');
  });

  it('getSelectedOrActiveTrackId falls back to selectedTrackId', () => {
    const deps = createMockDeps();
    deps.selectedTrackId.value = 'track-1';
    const mod = createTimelineSelectionModule(deps);

    expect(mod.getSelectedOrActiveTrackId()).toBe('track-1');
  });

  it('syncs global selection store when selecting clips by IDs', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectAllClipsOnTrack('track-1');
    expect(deps.selectionStore.selectTimelineItems).toHaveBeenCalledWith([
      { trackId: 'track-1', itemId: 'clip-1', kind: 'clip' },
      { trackId: 'track-1', itemId: 'clip-2', kind: 'clip' },
    ]);
  });
});
