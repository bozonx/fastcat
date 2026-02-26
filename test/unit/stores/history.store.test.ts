import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useHistoryStore } from '../../../src/stores/history.store';
import type { TimelineDocument } from '../../../src/timeline/types';

function makeDoc(id: string): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id,
    name: id,
    timebase: { fps: 30 },
    tracks: [],
  } as unknown as TimelineDocument;
}

describe('HistoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts empty', () => {
    const store = useHistoryStore();
    expect(store.past).toHaveLength(0);
    expect(store.future).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });

  it('push adds entry to past and clears future', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc-1');

    store.push({ type: 'add_clip_to_track', trackId: 't1', name: 'clip', path: '/a.mp4' }, doc);

    expect(store.past).toHaveLength(1);
    expect(store.past[0]?.commandType).toBe('add_clip_to_track');
    expect(store.past[0]?.label).toBe('Add clip');
    expect(store.past[0]?.snapshot).toStrictEqual(doc);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
  });

  it('push clears future (branching)', () => {
    const store = useHistoryStore();
    const doc1 = makeDoc('doc-1');
    const doc2 = makeDoc('doc-2');
    const doc3 = makeDoc('doc-3');

    store.push({ type: 'add_clip_to_track', trackId: 't1', name: 'clip', path: '/a.mp4' }, doc1);
    store.push({ type: 'remove_item', trackId: 't1', itemId: 'i1' }, doc2);

    store.undo(doc3);
    expect(store.future).toHaveLength(1);

    store.push({ type: 'rename_item', trackId: 't1', itemId: 'i1', name: 'new' }, doc2);
    expect(store.future).toHaveLength(0);
  });

  it('undo restores previous snapshot and moves entry to future', () => {
    const store = useHistoryStore();
    const snap1 = makeDoc('snap-1');
    const current = makeDoc('current');

    store.push({ type: 'add_clip_to_track', trackId: 't1', name: 'clip', path: '/a.mp4' }, snap1);

    const restored = store.undo(current);

    expect(restored).toStrictEqual(snap1);
    expect(store.past).toHaveLength(0);
    expect(store.future).toHaveLength(1);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  it('redo restores future snapshot and moves entry back to past', () => {
    const store = useHistoryStore();
    const snap1 = makeDoc('snap-1');
    const snap2 = makeDoc('snap-2');
    const current = makeDoc('current');

    store.push({ type: 'add_clip_to_track', trackId: 't1', name: 'clip', path: '/a.mp4' }, snap1);
    store.undo(snap2);

    const restored = store.redo(snap1);

    expect(restored).toStrictEqual(snap2);
    expect(store.past).toHaveLength(1);
    expect(store.future).toHaveLength(0);
    expect(store.canRedo).toBe(false);
  });

  it('undo returns null when no history', () => {
    const store = useHistoryStore();
    const result = store.undo(makeDoc('x'));
    expect(result).toBeNull();
  });

  it('redo returns null when no future', () => {
    const store = useHistoryStore();
    const result = store.redo(makeDoc('x'));
    expect(result).toBeNull();
  });

  it('clear resets all state', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc-1');

    store.push({ type: 'add_clip_to_track', trackId: 't1', name: 'clip', path: '/a.mp4' }, doc);
    store.push({ type: 'remove_item', trackId: 't1', itemId: 'i1' }, doc);

    store.clear();

    expect(store.past).toHaveLength(0);
    expect(store.future).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('limits history to MAX_HISTORY_SIZE (100)', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc');

    for (let i = 0; i < 110; i++) {
      store.push({ type: 'remove_item', trackId: 't1', itemId: `i${i}` }, doc);
    }

    expect(store.past.length).toBeLessThanOrEqual(100);
  });

  it('lastEntry reflects the most recent past entry', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc');

    expect(store.lastEntry).toBeNull();

    store.push({ type: 'add_clip_to_track', trackId: 't1', name: 'clip', path: '/a.mp4' }, doc);
    store.push({ type: 'remove_item', trackId: 't1', itemId: 'i1' }, doc);

    expect(store.lastEntry?.commandType).toBe('remove_item');
  });

  it('multiple undo/redo cycle preserves order', () => {
    const store = useHistoryStore();
    const snap1 = makeDoc('snap-1');
    const snap2 = makeDoc('snap-2');
    const snap3 = makeDoc('snap-3');

    store.push({ type: 'add_clip_to_track', trackId: 't1', name: 'c1', path: '/a.mp4' }, snap1);
    store.push({ type: 'remove_item', trackId: 't1', itemId: 'i1' }, snap2);

    // Undo twice
    const r1 = store.undo(snap3);
    expect(r1).toStrictEqual(snap2);

    const r2 = store.undo(snap2);
    expect(r2).toStrictEqual(snap1);

    // Redo once
    const r3 = store.redo(snap1);
    expect(r3).toStrictEqual(snap2);

    expect(store.past).toHaveLength(1);
    expect(store.future).toHaveLength(1);
  });
});
