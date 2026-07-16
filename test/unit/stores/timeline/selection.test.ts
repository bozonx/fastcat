/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createTimelineSelectionModule } from '~/stores/timeline/selection';

vi.mock('~/timeline/commands/utils', () => ({
  getLinkedClipGroupItemIds: vi.fn((_doc, id) => {
    if (id === 'clip-1') return ['clip-1', 'clip-3'];
    return [id];
  }),
}));

const mockDoc = {
  id: 'doc-1',
  tracks: [
    {
      id: 'track-1',
      items: [
        { id: 'clip-1', kind: 'clip', timelineRange: { startTicks: 0, durationTicks: 1_000_000 } },
        {
          id: 'clip-2',
          kind: 'clip',
          timelineRange: { startTicks: 2_000_000, durationTicks: 1_000_000 },
        },
        { id: 'gap-1', kind: 'gap', timelineRange: { startTicks: 1_000_000, durationTicks: 1_000_000 } },
      ],
    },
    {
      id: 'track-2',
      items: [{ id: 'clip-3', kind: 'clip', timelineRange: { startTicks: 0, durationTicks: 500_000 } }],
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

  it('selectTransition(input) clears items, selectTransition(null) preserves them', () => {
    const deps = createMockDeps();
    deps.selectedItemIds.value = ['clip-1'];
    const mod = createTimelineSelectionModule(deps);

    // Selecting a real transition replaces the clip selection.
    mod.selectTransition({ trackId: 'track-1', itemId: 'clip-1', edge: 'in' });
    expect(deps.selectedItemIds.value).toEqual([]);
    expect(deps.selectedTransition.value).toEqual({
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'in',
    });

    // Deselecting the transition must NOT wipe a fresh clip selection.
    deps.selectedItemIds.value = ['clip-2'];
    mod.selectTransition(null);
    expect(deps.selectedTransition.value).toBeNull();
    expect(deps.selectedItemIds.value).toEqual(['clip-2']);
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

  it('toggleSelection selects a single item and expands its linked group', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.toggleSelection('clip-1');
    expect(deps.selectedItemIds.value).toEqual(['clip-1', 'clip-3']);
  });

  it('toggleSelection with multi toggles whole linked groups', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.toggleSelection('clip-1', { multi: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-1', 'clip-3']);

    mod.toggleSelection('clip-2', { multi: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-1', 'clip-3', 'clip-2']);

    mod.toggleSelection('clip-1', { multi: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-2']);
  });

  it('selectAllClips selects every clip', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectAllClips();
    expect(deps.selectedItemIds.value.sort()).toEqual(['clip-1', 'clip-2', 'clip-3']);
  });

  it('selectAllTimelineItems selects every clip and gap', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectAllTimelineItems();
    expect(deps.selectedItemIds.value.sort()).toEqual(['clip-1', 'clip-2', 'clip-3', 'gap-1']);
    expect(deps.selectionStore.selectTimelineItems).toHaveBeenCalledWith([
      { trackId: 'track-1', itemId: 'clip-1', kind: 'clip' },
      { trackId: 'track-2', itemId: 'clip-3', kind: 'clip' },
      { trackId: 'track-1', itemId: 'clip-2', kind: 'clip' },
      { trackId: 'track-1', itemId: 'gap-1', kind: 'gap' },
    ]);
  });

  it('selectAllClipsOnTrack selects clips on the given track and expands linked groups across tracks', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectAllClipsOnTrack('track-1');
    expect(deps.selectedItemIds.value.sort()).toEqual(['clip-1', 'clip-2', 'clip-3']);
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
      { trackId: 'track-2', itemId: 'clip-3', kind: 'clip' },
      { trackId: 'track-1', itemId: 'clip-2', kind: 'clip' },
    ]);
  });

  it('selectTimelineItems expands linked group by default', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectTimelineItems(['clip-1']);
    expect(deps.selectedItemIds.value).toEqual(['clip-1', 'clip-3']);
    expect(deps.selectionStore.selectTimelineItems).toHaveBeenCalledWith([
      { trackId: 'track-1', itemId: 'clip-1', kind: 'clip' },
      { trackId: 'track-2', itemId: 'clip-3', kind: 'clip' },
    ]);
  });

  it('selectTimelineItems with bypassGroup skips linked group expansion', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectTimelineItems(['clip-1'], { bypassGroup: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-1']);
    expect(deps.selectionStore.selectTimelineItems).toHaveBeenCalledWith([
      { trackId: 'track-1', itemId: 'clip-1', kind: 'clip' },
    ]);
  });

  it('selectTimelineItems with bypassGroup and append merges single items', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectTimelineItems(['clip-1'], { bypassGroup: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-1']);

    mod.selectTimelineItems(['clip-2'], { append: true, bypassGroup: true });
    expect(deps.selectedItemIds.value).toEqual(['clip-1', 'clip-2']);
  });

  it('selectTimelineItems with objects and bypassGroup skips group expansion', () => {
    const deps = createMockDeps();
    const mod = createTimelineSelectionModule(deps);

    mod.selectTimelineItems([{ trackId: 'track-1', itemId: 'clip-1', kind: 'clip' as const }], {
      bypassGroup: true,
    });
    expect(deps.selectedItemIds.value).toEqual(['clip-1']);
    expect(deps.selectionStore.selectTimelineItems).toHaveBeenCalledWith([
      { trackId: 'track-1', itemId: 'clip-1', kind: 'clip' },
    ]);
  });
});
