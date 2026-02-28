import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FileManagerTree from '../../../../src/components/file-manager/FileManagerTree.vue';
import type { FsEntry } from '../../../../src/types/fs';

function createDir(params: {
  name: string;
  path: string;
  expanded?: boolean;
  children?: FsEntry[];
}): FsEntry {
  return {
    name: params.name,
    kind: 'directory',
    handle: {} as unknown as FileSystemDirectoryHandle,
    path: params.path,
    expanded: params.expanded ?? false,
    children: params.children,
  };
}

function createFile(params: { name: string; path: string }): FsEntry {
  return {
    name: params.name,
    kind: 'file',
    handle: {} as unknown as FileSystemFileHandle,
    path: params.path,
  };
}

describe('FileManagerTree', () => {
  it('emits select on entry click', async () => {
    const entries: FsEntry[] = [createFile({ name: 'a.mp4', path: '_video/a.mp4' })];

    const wrapper = mount(FileManagerTree, {
      props: {
        entries,
        depth: 0,
        selectedPath: null,
        getFileIcon: () => 'i-heroicons-document',
        getEntryMeta: () => ({ hasProxy: false, generatingProxy: false }),
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true,
        },
      },
    });

    await wrapper.get('[role="treeitem"]').trigger('click');

    const emitted = wrapper.emitted('select');
    expect(emitted?.length).toBe(1);
    expect(emitted?.[0]?.[0]).toEqual(entries[0]);
  });

  it('emits toggle when caret clicked', async () => {
    const dir = createDir({ name: '_video', path: '_video', expanded: false });

    const wrapper = mount(FileManagerTree, {
      props: {
        entries: [dir],
        depth: 0,
        selectedPath: null,
        getFileIcon: () => 'i-heroicons-folder',
        getEntryMeta: () => ({ hasProxy: false, generatingProxy: false }),
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: { template: '<i />' },
        },
      },
    });

    await wrapper.find('i').trigger('click');

    const emitted = wrapper.emitted('toggle');
    expect(emitted?.length).toBe(1);
    expect(emitted?.[0]?.[0]).toEqual(dir);
  });

  it('emits requestMove on internal move drop', async () => {
    const dir = createDir({ name: '_video', path: '_video', expanded: false });

    const wrapper = mount(FileManagerTree, {
      props: {
        entries: [dir],
        depth: 0,
        selectedPath: null,
        getFileIcon: () => 'i-heroicons-folder',
        getEntryMeta: () => ({ hasProxy: false, generatingProxy: false }),
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: { template: '<i />' },
        },
      },
    });

    const treeItem = wrapper.get('[role="treeitem"]');

    const payload = JSON.stringify({ path: '_video/a.mp4' });
    const dataTransfer = {
      types: ['application/gran-file-manager-move'],
      getData: (type: string) => (type === 'application/gran-file-manager-move' ? payload : ''),
      files: [],
      items: [],
      dropEffect: 'move',
    };

    await treeItem.trigger('drop', { dataTransfer });

    const emitted = wrapper.emitted('requestMove');
    expect(emitted?.length).toBe(1);
    expect(emitted?.[0]?.[0]).toEqual({
      sourcePath: '_video/a.mp4',
      targetDirHandle: dir.handle,
      targetDirPath: dir.path,
    });
  });
});
