import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useClipboardStore } from '~/stores/clipboard.store';

describe('useClipboardStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('clipboard payload', () => {
    it('sets and clears payload', () => {
      const store = useClipboardStore();
      const payload = {
        source: 'fileManager' as const,
        operation: 'copy' as const,
        items: [{ path: '/a.mp4', kind: 'file' as const, name: 'a.mp4' }],
      };
      store.setClipboardPayload(payload);
      expect(store.clipboardPayload).toEqual(payload);
      store.clearClipboardPayload();
      expect(store.clipboardPayload).toBeNull();
    });

    it('computes hasFileManagerPayload', () => {
      const store = useClipboardStore();
      expect(store.hasFileManagerPayload).toBe(false);
      store.setClipboardPayload({
        source: 'fileManager',
        operation: 'copy',
        items: [{ path: '/a.mp4', kind: 'file', name: 'a.mp4' }],
      });
      expect(store.hasFileManagerPayload).toBe(true);
    });

    it('computes hasTimelinePayload', () => {
      const store = useClipboardStore();
      expect(store.hasTimelinePayload).toBe(false);
      store.setClipboardPayload({
        source: 'timeline',
        operation: 'cut',
        items: [{ sourceTrackId: 'v1', clip: { id: 'c1' } as any }],
      });
      expect(store.hasTimelinePayload).toBe(true);
    });

    it('computes hasClipParametersPayload', () => {
      const store = useClipboardStore();
      expect(store.hasClipParametersPayload).toBe(false);
      store.setClipboardPayload({
        source: 'clipParameters',
        snapshot: {
          clipType: 'media',
          trackKind: 'video',
          groups: { opacity: { opacity: 0.5 } },
        },
      });
      expect(store.hasClipParametersPayload).toBe(true);
    });
  });

  describe('drag operations', () => {
    it('sets drag operation and instance ids', () => {
      const store = useClipboardStore();
      store.setCurrentDragOperation('move');
      expect(store.currentDragOperation).toBe('move');
      store.setDragSourceFileManagerInstanceId('src-1');
      expect(store.dragSourceFileManagerInstanceId).toBe('src-1');
      store.setDragTargetFileManagerInstanceId('tgt-1');
      expect(store.dragTargetFileManagerInstanceId).toBe('tgt-1');
    });

    it('sets and clears dragged items', () => {
      const store = useClipboardStore();
      const items = [{ path: '/b.mp4', name: 'b.mp4' }];
      store.setDraggedItems(items as any);
      expect(store.draggedItems).toEqual(items);
      store.clearDraggedItems();
      expect(store.draggedItems).toEqual([]);
    });

    it('sets drag source vfs', () => {
      const store = useClipboardStore();
      const vfs = { readFile: () => Promise.resolve('') } as any;
      store.setDragSourceVfs(vfs);
      expect(store.dragSourceVfs).toBe(vfs);
    });
  });

  describe('file manager vfs registry', () => {
    it('registers and retrieves vfs', () => {
      const store = useClipboardStore();
      const vfs = { readFile: () => Promise.resolve('') } as any;
      store.registerFileManagerVfs('fm-1', vfs);
      expect(store.getFileManagerVfs('fm-1')).toBe(vfs);
    });

    it('increments count on duplicate registration', () => {
      const store = useClipboardStore();
      const vfs = { readFile: () => Promise.resolve('') } as any;
      store.registerFileManagerVfs('fm-1', vfs);
      store.registerFileManagerVfs('fm-1', vfs);
      expect(store.fileManagerVfsRegistry['fm-1'].count).toBe(2);
    });

    it('unregisters and decrements count', () => {
      const store = useClipboardStore();
      const vfs = { readFile: () => Promise.resolve('') } as any;
      store.registerFileManagerVfs('fm-1', vfs);
      store.registerFileManagerVfs('fm-1', vfs);
      store.unregisterFileManagerVfs('fm-1');
      expect(store.fileManagerVfsRegistry['fm-1'].count).toBe(1);
    });

    it('removes entry when count reaches zero', () => {
      const store = useClipboardStore();
      const vfs = { readFile: () => Promise.resolve('') } as any;
      store.registerFileManagerVfs('fm-1', vfs);
      store.unregisterFileManagerVfs('fm-1');
      expect(store.fileManagerVfsRegistry).not.toHaveProperty('fm-1');
    });

    it('returns null for unknown or missing instance id', () => {
      const store = useClipboardStore();
      expect(store.getFileManagerVfs('unknown')).toBeNull();
      expect(store.getFileManagerVfs(null)).toBeNull();
      expect(store.getFileManagerVfs(undefined)).toBeNull();
    });

    it('safely handles unregister for unknown instance id', () => {
      const store = useClipboardStore();
      store.unregisterFileManagerVfs('unknown');
      expect(store.fileManagerVfsRegistry).toEqual({});
    });
  });
});
