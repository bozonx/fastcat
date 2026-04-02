/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useHistoryStore } from '~/stores/history.store';
import type { TimelineDocument } from '~/timeline/types';

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
    expect(store.canUndo('timeline')).toBe(false);
    expect(store.canRedo('timeline')).toBe(false);
  });

  it('push adds entry to past and clears future', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc-1');

    store.push('timeline', 'add_clip_to_track', doc, 'Add clip');

    expect(store.past).toHaveLength(1);
    expect(store.past[0]?.commandType).toBe('add_clip_to_track');
    expect(store.past[0]?.labelKey).toBe('Add clip');
    expect(store.past[0]?.snapshot).toStrictEqual(doc);
    expect(store.canUndo('timeline')).toBe(true);
    expect(store.canRedo('timeline')).toBe(false);
  });

  it('push clears future (branching)', () => {
    const store = useHistoryStore();
    const doc1 = makeDoc('doc-1');
    const doc2 = makeDoc('doc-2');
    const doc3 = makeDoc('doc-3');

    store.push('timeline', 'add_clip_to_track', doc1, 'Add clip');
    store.push('timeline', 'remove_item', doc2, 'Remove item');

    store.undo('timeline', doc3);
    expect(store.future).toHaveLength(1);

    store.push('timeline', 'rename_item', doc2, 'Rename item');
    expect(store.future).toHaveLength(0);
  });

  it('undo restores previous snapshot and moves entry to future', () => {
    const store = useHistoryStore();
    const snap1 = makeDoc('snap-1');
    const current = makeDoc('current');

    store.push('timeline', 'add_clip_to_track', snap1, 'Add clip');

    const restored = store.undo('timeline', current);

    expect(restored).toStrictEqual(snap1);
    expect(store.past).toHaveLength(0);
    expect(store.future).toHaveLength(1);
    expect(store.canUndo('timeline')).toBe(false);
    expect(store.canRedo('timeline')).toBe(true);
  });

  it('redo restores future snapshot and moves entry back to past', () => {
    const store = useHistoryStore();
    const snap1 = makeDoc('snap-1');
    const snap2 = makeDoc('snap-2');
    const current = makeDoc('current');

    store.push('timeline', 'add_clip_to_track', snap1, 'Add clip');
    store.undo('timeline', snap2);

    const restored = store.redo('timeline', snap1);

    expect(restored).toStrictEqual(snap2);
    expect(store.past).toHaveLength(1);
    expect(store.future).toHaveLength(0);
    expect(store.canRedo('timeline')).toBe(false);
  });

  it('undo returns null when no history', () => {
    const store = useHistoryStore();
    const result = store.undo('timeline', makeDoc('x'));
    expect(result).toBeNull();
  });

  it('redo returns null when no future', () => {
    const store = useHistoryStore();
    const result = store.redo('timeline', makeDoc('x'));
    expect(result).toBeNull();
  });

  it('clear resets all state', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc-1');

    store.push('timeline', 'add_clip_to_track', doc, 'Add clip');
    store.push('timeline', 'remove_item', doc, 'Remove item');

    store.clear('timeline');

    expect(store.past).toHaveLength(0);
    expect(store.future).toHaveLength(0);
    expect(store.canUndo('timeline')).toBe(false);
  });

  it('limits history to MAX_HISTORY_SIZE (100)', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc');

    for (let i = 0; i < 110; i++) {
      store.push('timeline', 'remove_item', doc, `Remove item ${i}`);
    }

    expect(store.past.length).toBeLessThanOrEqual(100);
  });

  it('lastEntry reflects the most recent past entry', () => {
    const store = useHistoryStore();
    const doc = makeDoc('doc');

    expect(store.lastEntry('timeline')).toBeNull();

    store.push('timeline', 'add_clip_to_track', doc, 'Add clip');
    store.push('timeline', 'remove_item', doc, 'Remove item');

    expect(store.lastEntry('timeline')?.commandType).toBe('remove_item');
  });

  it('multiple undo/redo cycle preserves order', () => {
    const store = useHistoryStore();
    const snap1 = makeDoc('snap-1');
    const snap2 = makeDoc('snap-2');
    const snap3 = makeDoc('snap-3');

    store.push('timeline', 'add_clip_to_track', snap1, 'Add clip');
    store.push('timeline', 'remove_item', snap2, 'Remove item');

    // Undo twice
    const r1 = store.undo('timeline', snap3);
    expect(r1).toStrictEqual(snap2);

    const r2 = store.undo('timeline', snap2);
    expect(r2).toStrictEqual(snap1);

    // Redo once
    const r3 = store.redo('timeline', snap1);
    expect(r3).toStrictEqual(snap2);

    expect(store.past).toHaveLength(1);
    expect(store.future).toHaveLength(1);
  });

  describe('command-based scopes', () => {
    it('preserves snapshot during undo for command scopes', () => {
      const store = useHistoryStore();
      store.registerCommandScope('fileManager');

      const command = {
        undo: { type: 'delete', path: '/folder' },
        redo: { type: 'createFolder', parentPath: '', name: 'folder' },
      };

      store.push('fileManager', 'createFolder', command, 'Create folder');

      const restored = store.undo('fileManager', 'current');

      expect(restored).toStrictEqual(command);
      expect(store.past).toHaveLength(0);
      expect(store.future).toHaveLength(1);
      // Snapshot should be preserved (not replaced with currentDoc)
      expect(store.future[0]?.snapshot).toStrictEqual(command);
    });

    it('preserves snapshot during redo for command scopes', () => {
      const store = useHistoryStore();
      store.registerCommandScope('fileManager');

      const command = {
        undo: { type: 'delete', path: '/folder' },
        redo: { type: 'createFolder', parentPath: '', name: 'folder' },
      };

      store.push('fileManager', 'createFolder', command, 'Create folder');
      store.undo('fileManager', 'current');

      const restored = store.redo('fileManager', 'another');

      expect(restored).toStrictEqual(command);
      expect(store.past).toHaveLength(1);
      expect(store.future).toHaveLength(0);
      // Snapshot should be preserved
      expect(store.past[0]?.snapshot).toStrictEqual(command);
    });

    it('undoGlobal extracts undo command for command scopes', () => {
      const store = useHistoryStore();
      store.registerCommandScope('fileManager');

      store.push(
        'fileManager',
        'createFolder',
        {
          undo: { type: 'delete', path: '/folder' },
          redo: { type: 'createFolder', parentPath: '', name: 'folder' },
        },
        'Create folder',
      );

      const entry = store.undoGlobal();

      expect(entry).not.toBeNull();
      expect(entry?.scope).toBe('fileManager');
      // Should return the undo command, not the full structure
      expect(entry?.snapshot).toStrictEqual({ type: 'delete', path: '/folder' });
    });

    it('redoGlobal extracts redo command for command scopes', () => {
      const store = useHistoryStore();
      store.registerCommandScope('fileManager');

      store.push(
        'fileManager',
        'createFolder',
        {
          undo: { type: 'delete', path: '/folder' },
          redo: { type: 'createFolder', parentPath: '', name: 'folder' },
        },
        'Create folder',
      );
      store.undoGlobal();

      const entry = store.redoGlobal();

      expect(entry).not.toBeNull();
      expect(entry?.scope).toBe('fileManager');
      // Should return the redo command
      expect(entry?.snapshot).toStrictEqual({
        type: 'createFolder',
        parentPath: '',
        name: 'folder',
      });
    });

    it('snapshot-based scopes replace snapshot with currentDoc during undo', () => {
      const store = useHistoryStore();
      // timeline is NOT a command scope

      const doc1 = makeDoc('doc-1');
      const doc2 = makeDoc('doc-2');

      store.push('timeline', 'add_clip_to_track', doc1, 'Add clip');

      store.undo('timeline', doc2);

      // For snapshot-based scopes, currentDoc should be saved for redo
      expect(store.future[0]?.snapshot).toStrictEqual(doc2);
    });
  });
});
