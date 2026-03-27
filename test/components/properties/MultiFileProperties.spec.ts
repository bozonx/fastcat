import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { ref } from 'vue';

vi.mock('~/composables/fileManager/useFileManager', () => ({
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

    expect(component.text()).toContain('3 items selected');
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
    await component.vm.$nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
    await component.vm.$nextTick();

    expect(component.text()).toContain('2 KB'); // 1024 + 1024 bytes (2 files)
  });

  it('shows actions section', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: {
        entries: mockEntries as any[],
      },
    });

    expect(component.text()).toContain('Actions');
    expect(component.text()).toContain('Copy');
    expect(component.text()).toContain('Cut');
    expect(component.text()).toContain('Delete');
  });
});
