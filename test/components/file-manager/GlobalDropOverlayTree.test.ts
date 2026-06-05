import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import GlobalDropOverlayTree from '~/components/file-manager/GlobalDropOverlayTree.vue';
import type { FsEntry } from '~/types/fs';

describe('GlobalDropOverlayTree', () => {
  const entries: FsEntry[] = [
    {
      name: 'Video',
      kind: 'directory',
      path: '_video',
      children: [
        { name: 'Sub', kind: 'directory', path: '_video/sub', children: [] },
      ],
    },
    { name: 'Audio', kind: 'directory', path: '_audio', children: [] },
  ];

  function createWrapper(props: { entries?: FsEntry[]; depth?: number; dropOverPath?: string | null } = {}) {
    return mount(GlobalDropOverlayTree, {
      props: {
        entries: props.entries ?? entries,
        depth: props.depth ?? 0,
        dropOverPath: props.dropOverPath ?? null,
        getFolderIcon: () => 'i-heroicons-folder',
      },
      global: {
        stubs: {
          UIcon: true,
        },
      },
    });
  }

  it('renders folder entries recursively', () => {
    const wrapper = createWrapper();
    const items = wrapper.findAll('[data-folder-path]');

    expect(items.length).toBe(3);
    expect(items[0]!.attributes('data-folder-path')).toBe('_video');
    expect(items[1]!.attributes('data-folder-path')).toBe('_video/sub');
    expect(items[2]!.attributes('data-folder-path')).toBe('_audio');
  });

  it('emits folderDragOver on dragover', async () => {
    const wrapper = createWrapper();
    const firstItem = wrapper.find('[data-folder-path="_video"]');

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { types: ['Files'] },
    } as unknown as DragEvent;

    await firstItem.trigger('dragover', event);
    expect(wrapper.emitted('folderDragOver')).toHaveLength(1);
    expect(wrapper.emitted('folderDragOver')![0]![1]).toBe('_video');
  });

  it('emits folderDrop on drop with the correct path', async () => {
    const wrapper = createWrapper();
    const firstItem = wrapper.find('[data-folder-path="_video"]');

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [{ name: 'test.mp4' }] as unknown as FileList },
    } as unknown as DragEvent;

    await firstItem.trigger('drop', event);
    expect(wrapper.emitted('folderDrop')).toHaveLength(1);
    expect(wrapper.emitted('folderDrop')![0]![1]).toBe('_video');
  });

  it('applies highlight class when dropOverPath matches', () => {
    const wrapper = createWrapper({ dropOverPath: '_video' });
    const firstItem = wrapper.find('[data-folder-path="_video"]');

    expect(firstItem.classes()).toContain('bg-primary-500/20');
  });
});
