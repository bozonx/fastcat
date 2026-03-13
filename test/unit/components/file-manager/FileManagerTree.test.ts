import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FileManagerTree from '../../../../src/components/file-manager/FileManagerTree.vue';
import type { FsEntry } from '../../../../src/types/fs';
import type { RemoteFsEntry } from '../../../../src/utils/remote-vfs';

vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: () => 'video',
  isOpenableProjectFileName: () => false,
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
  useSelectionStore: () => ({
    selectedPaths: [],
  }),
}));

// We mock useDraggedFile to control dragged payload directly, avoiding event dataTransfer complexity
vi.mock('~/composables/useDraggedFile', () => ({
  INTERNAL_DRAG_TYPE: 'application/fastcat-fs-entry',
  REMOTE_FILE_DRAG_TYPE: 'application/fastcat-remote-file',
  FILE_MANAGER_MOVE_DRAG_TYPE: 'application/fastcat-move',
  useDraggedFile: () => ({
    draggedFile: null,
    setDraggedFile: vi.fn(),
    clearDraggedFile: vi.fn(),
  }),
}));

describe('FileManagerTree', () => {
  it('renders root entries', () => {
    const rootEntries: FsEntry[] = [
      {
        name: '_video',
        kind: 'directory',
        path: '_video',
        expanded: false,
      },
    ];
    const wrapper = mount(FileManagerTree, {
      props: {
        entries: rootEntries,
        depth: 0,
      },
    });

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
            expanded: false,
          },
        ],
      },
    ];
    const wrapper = mount(FileManagerTree, {
      props: {
        entries: rootEntries,
        depth: 0,
      },
    });

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
    const wrapper = mount(FileManagerTree, {
      props: {
        entries: [dir],
        depth: 0,
      },
    });

    const dropzones = wrapper.findAll('div').filter((w) => w.attributes('role') === 'treeitem');
    const dropzone = dropzones.at(0);
    expect(dropzone?.exists()).toBe(true);

    const mockEvent = {
      dataTransfer: {
        types: ['application/fastcat-move'],
        getData: vi.fn((type) => {
          if (type === 'application/fastcat-move') {
            return JSON.stringify({
              path: '_video/a.mp4',
            });
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

  it('emits requestDownload on remote file drop', async () => {
    const dir: FsEntry = {
      name: '_video',
      kind: 'directory',
      path: '_video',
      expanded: false,
    };
    const wrapper = mount(FileManagerTree, {
      props: {
        entries: [dir],
        depth: 0,
      },
    });

    const dropzones = wrapper.findAll('div').filter((w) => w.attributes('role') === 'treeitem');
    const dropzone = dropzones.at(0);
    expect(dropzone?.exists()).toBe(true);

    const remoteEntry: RemoteFsEntry = {
      source: 'remote',
      remoteId: 'file1',
      remoteType: 'file',
      name: 'remote.mp4',
      kind: 'file',
      path: '/collections/remote.mp4',
      remotePath: '/collections/remote.mp4',
      size: 1024,
      lastModified: 1000,
      mimeType: 'video/mp4',
      remoteUrl: 'https://example.com/remote.mp4',
    };

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
});
