/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSelectionStore } from '~/stores/selection.store';
import type { FsEntry } from '~/types/fs';

describe('useSelectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('initially has no selected entity', () => {
    const store = useSelectionStore();
    expect(store.selectedEntity).toBeNull();
  });

  it('selects a single timeline item', () => {
    const store = useSelectionStore();
    store.selectTimelineItem('track-1', 'clip-1', 'clip');
    expect(store.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'clip',
      trackId: 'track-1',
      itemId: 'clip-1',
    });
  });

  it('selects multiple timeline items', () => {
    const store = useSelectionStore();
    const items = [
      { trackId: 'track-1', itemId: 'clip-1' },
      { trackId: 'track-1', itemId: 'clip-2' },
    ];
    store.selectTimelineItems(items);
    expect(store.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'clips',
      items,
    });
  });

  it('clears selection when multiple items list is empty', () => {
    const store = useSelectionStore();
    store.selectTimelineItem('track-1', 'clip-1');
    store.selectTimelineItems([]);
    expect(store.selectedEntity).toBeNull();
  });

  it('converts single item array to single item selection', () => {
    const store = useSelectionStore();
    store.selectTimelineItems([{ trackId: 'track-1', itemId: 'clip-1' }]);
    expect(store.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'clip',
      trackId: 'track-1',
      itemId: 'clip-1',
    });
  });

  it('selects a timeline track', () => {
    const store = useSelectionStore();
    store.selectTimelineTrack('track-1');
    expect(store.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'track',
      trackId: 'track-1',
    });
  });

  it('selects a timeline transition', () => {
    const store = useSelectionStore();
    store.selectTimelineTransition('track-1', 'clip-1', 'in');
    expect(store.selectedEntity).toEqual({
      source: 'timeline',
      kind: 'transition',
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'in',
    });
  });

  it('selects a fs entry', () => {
    const store = useSelectionStore();
    const entry: FsEntry = {
      kind: 'file',
      name: 'test.mp4',
      path: '/test.mp4',
      source: 'local',
    };
    store.selectFsEntry(entry);
    expect(store.selectedEntity).toEqual({
      source: 'fileManager',
      kind: 'file',
      path: '/test.mp4',
      name: 'test.mp4',
      entry,
      instanceId: undefined,
      isExternal: undefined,
      origin: 'project-manager',
    });
  });

  it('selects multiple fs entries', () => {
    const store = useSelectionStore();
    const entries: FsEntry[] = [
      { kind: 'file', name: '1.mp4', path: '/1.mp4', source: 'local' },
      { kind: 'file', name: '2.mp4', path: '/2.mp4', source: 'local' },
    ];
    store.selectFsEntries(entries);
    expect(store.selectedEntity).toEqual({
      source: 'fileManager',
      kind: 'multiple',
      entries,
      instanceId: undefined,
      isExternal: undefined,
      origin: 'project-manager',
    });
  });

  it('isTrackVisuallySelected correctly identifies selection', () => {
    const store = useSelectionStore();

    // By track
    store.selectTimelineTrack('track-1');
    expect(store.isTrackVisuallySelected('track-1')).toBe(true);
    expect(store.isTrackVisuallySelected('track-2')).toBe(false);

    // By clip on track
    store.selectTimelineItem('track-1', 'clip-1');
    expect(store.isTrackVisuallySelected('track-1')).toBe(true);

    // By multiple clips
    store.selectTimelineItems([
      { trackId: 'track-1', itemId: 'clip-1' },
      { trackId: 'track-2', itemId: 'clip-2' },
    ]);
    expect(store.isTrackVisuallySelected('track-1')).toBe(true);
    expect(store.isTrackVisuallySelected('track-2')).toBe(true);
    expect(store.isTrackVisuallySelected('track-3')).toBe(false);
  });

  it('clears selection', () => {
    const store = useSelectionStore();
    store.selectTimelineTrack('track-1');
    store.clearSelection();
    expect(store.selectedEntity).toBeNull();
  });
});
