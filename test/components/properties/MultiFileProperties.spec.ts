import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { ref } from 'vue';

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: vi.fn(() => ({
    vfs: {
      getFile: vi.fn(async (path) => ({ size: 1024 })),
    },
  })),
}));

describe('MultiFileProperties.vue', () => {
  const mockEntries = [
    { kind: 'file', name: 'video1.mp4', path: '/p/v1.mp4' },
    { kind: 'file', name: 'image1.jpg', path: '/p/i1.jpg' },
    { kind: 'directory', name: 'folder1', path: '/p/f1' },
  ];

  it('renders summary for multiple items', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: {
        entries: mockEntries as any[],
      },
    });

    expect(component.text()).toContain('3 common.itemsSelected');
    expect(component.text()).toContain('video');
    expect(component.text()).toContain('image');
    expect(component.text()).toContain('folder');
  });

  it('calculates total size correctly', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: {
        entries: mockEntries as any[],
      },
    });

    // Wait for watcher to finish async size calculation
    while (component.vm.isCalculatingSize) {
      await component.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0)); // Still need a tiny yield to let the await in the component proceed
    }
    await component.vm.$nextTick();

    expect(component.text()).toContain('2 KB'); // 1024 + 1024 bytes (2 files)
  });

  it('shows actions section', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: {
        entries: mockEntries as any[],
      },
    });

    expect(component.text()).toContain('videoEditor.fileManager.actions.title');
    // Primary actions have title but no label text
    expect(component.find('button[title="common.copy"]').exists()).toBe(true);
    expect(component.find('button[title="common.cut"]').exists()).toBe(true);
    expect(component.find('button[title="common.delete"]').exists()).toBe(true);
    expect(component.text()).toContain('videoEditor.fileManager.proxy.create');
    expect(component.text()).toContain('videoEditor.fileManager.actions.extractAudio');
  });
});
