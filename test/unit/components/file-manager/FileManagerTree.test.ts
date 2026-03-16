import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import FileManagerTree from '../../../../src/components/file-manager/FileManagerTree.vue';
import type { FsEntry } from '../../../../src/types/fs';
import type { RemoteFsEntry } from '../../../../src/utils/remote-vfs';

const selectionStoreMock = {
  selectedEntity: null as any,
  selectFsEntries: vi.fn(),
  clearSelection: vi.fn(),
};

const uiStoreMock = reactive({
  fileTreeSelectAllTrigger: 0,
});

vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: () => 'video',
  isOpenableProjectFileName: () => false,
  VIDEO_EXTENSIONS: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  AUDIO_EXTENSIONS: ['mp3', 'wav'],
  IMAGE_EXTENSIONS: ['jpg', 'png'],
  TEXT_EXTENSIONS: ['txt', 'md'],
  TIMELINE_EXTENSIONS: ['otio'],
}));

vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => ({
    getProxyPath: vi.fn(),
    isProxyGenerating: vi.fn(),
    getProxyProgress: vi.fn(),
    generatingProxies: new Set(),
  }),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => selectionStoreMock,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStoreMock,
}));

vi.mock('~/composables/useDraggedFile', () => ({
  INTERNAL_DRAG_TYPE: 'application/fastcat-fs-entry',
  REMOTE_FILE_DRAG_TYPE: 'application/fastcat-remote-file',
  FILE_MANAGER_COPY_DRAG_TYPE: 'application/fastcat-copy',
  FILE_MANAGER_MOVE_DRAG_TYPE: 'application/fastcat-move',
  useDraggedFile: () => ({
    draggedFile: null,
    setDraggedFile: vi.fn(),
    clearDraggedFile: vi.fn(),
  }),
}));

function mountTree(entries: FsEntry[]) {
  return mount(FileManagerTree, {
    props: {
      entries,
      depth: 0,
    },
  });
}

describe('FileManagerTree', () => {
  beforeEach(() => {
    selectionStoreMock.selectedEntity = null;
    selectionStoreMock.selectFsEntries.mockReset();
    selectionStoreMock.clearSelection.mockReset();
    uiStoreMock.fileTreeSelectAllTrigger = 0;
  });

  it('renders root entries', () => {
    const rootEntries: FsEntry[] = [
      {
        name: '_video',
        kind: 'directory',
        path: '_video',
        expanded: false,
      },
    ];

    const wrapper = mountTree(rootEntries);

    expect(wrapper.text()).toContain('_video');
  });

  it('renders nested children when expanded', () => {
    const rootEntries: FsEntry[] = [
      {
        name: '_video',
        kind: 'directory',
        path: '_video',
        expanded: true,
        children: [
          {
            name: 'child.mp4',
            kind: 'file',
            path: '_video/child.mp4',
            parentPath: '_video',
            expanded: false,
          },
        ],
      },
    ];

    const wrapper = mountTree(rootEntries);

    expect(wrapper.text()).toContain('_video');
    expect(wrapper.text()).toContain('child.mp4');
  });

  it('emits requestMove on internal move drop', async () => {
    const dir: FsEntry = {
      name: '_video',
      kind: 'directory',
      path: '_video',
      expanded: false,
    };

    const wrapper = mountTree([dir]);
    const dropzone = wrapper.findAll('div').find((w) => w.attributes('role') === 'treeitem');

    expect(dropzone?.exists()).toBe(true);

    const mockEvent = {
      dataTransfer: {
        types: ['application/fastcat-move'],
        getData: vi.fn((type) => {
          if (type === 'application/fastcat-move') {
            return JSON.stringify({ path: '_video/a.mp4' });
          }
          return '';
        }),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;

    await dropzone?.trigger('drop', mockEvent);

    const emitted = wrapper.emitted('requestMove');
    expect(emitted?.length).toBe(1);
    expect(emitted?.[0]?.[0]).toEqual({
      sourcePath: '_video/a.mp4',
      targetDirPath: '_video',
    });
  });

  it('emits requestCopy on internal copy drop', async () => {
    const dir: FsEntry = {
      name: '_video',
      kind: 'directory',
      path: '_video',
      expanded: false,
    };

    const wrapper = mountTree([dir]);
    const dropzone = wrapper.findAll('div').find((w) => w.attributes('role') === 'treeitem');

    expect(dropzone?.exists()).toBe(true);

    const mockEvent = {
      dataTransfer: {
        types: ['application/fastcat-copy'],
        getData: vi.fn((type) => {
          if (type === 'application/fastcat-copy') {
            return JSON.stringify({ path: '_video/a.mp4' });
          }
          return '';
        }),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;

    await dropzone?.trigger('drop', mockEvent);

    const emitted = wrapper.emitted('requestCopy');
    expect(emitted?.length).toBe(1);
    expect(emitted?.[0]?.[0]).toEqual({
      sourcePath: '_video/a.mp4',
      targetDirPath: '_video',
    });
  });

  it('emits requestDownload on remote file drop', async () => {
    const dir: FsEntry = {
      name: '_video',
      kind: 'directory',
      path: '_video',
      expanded: false,
    };

    const wrapper = mountTree([dir]);
    const dropzone = wrapper.findAll('div').find((w) => w.attributes('role') === 'treeitem');

    expect(dropzone?.exists()).toBe(true);

    const remoteEntry = {
      source: 'remote',
      remoteId: 'file1',
      remoteType: 'file',
      path: '/collections/remote.mp4',
      remotePath: '/collections/remote.mp4',
      size: 1024,
      lastModified: 1000,
      mimeType: 'video/mp4',
      name: 'remote.mp4',
      kind: 'file',
      remoteData: {
        id: 'file1',
        type: 'file',
        path: '/collections/remote.mp4',
        name: 'remote.mp4',
        title: 'remote.mp4',
      } as any,
    } as unknown as RemoteFsEntry;

    const mockEvent = {
      dataTransfer: {
        types: ['application/fastcat-remote-file'],
        getData: vi.fn((type) => {
          if (type === 'application/fastcat-remote-file') {
            return JSON.stringify({
              ...remoteEntry,
            });
          }
          return '';
        }),
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent;

    await dropzone?.trigger('drop', mockEvent);

    const emitted = wrapper.emitted('requestDownload');
    expect(emitted?.length).toBe(1);
    expect(emitted?.[0]?.[0]).toEqual({
      entry: remoteEntry,
      targetDirPath: '_video',
    });
  });

  it('selects only siblings for select all hotkey', async () => {
    const videoA: FsEntry = {
      name: 'a.mp4',
      kind: 'file',
      path: '_video/a.mp4',
      parentPath: '_video',
    };
    const videoB: FsEntry = {
      name: 'b.mp4',
      kind: 'file',
      path: '_video/b.mp4',
      parentPath: '_video',
    };
    const audioC: FsEntry = {
      name: 'c.wav',
      kind: 'file',
      path: '_audio/c.wav',
      parentPath: '_audio',
    };

    const rootEntries: FsEntry[] = [
      {
        name: '_video',
        kind: 'directory',
        path: '_video',
        expanded: true,
        children: [videoA, videoB],
      },
      {
        name: '_audio',
        kind: 'directory',
        path: '_audio',
        expanded: true,
        children: [audioC],
      },
    ];

    selectionStoreMock.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: videoA.path,
      name: videoA.name,
      entry: videoA,
    };

    mountTree(rootEntries);

    uiStoreMock.fileTreeSelectAllTrigger++;
    await Promise.resolve();

    expect(selectionStoreMock.selectFsEntries).toHaveBeenCalledWith([videoA, videoB]);
    expect(selectionStoreMock.selectFsEntries).not.toHaveBeenCalledWith([videoA, videoB, audioC]);
  });
});
