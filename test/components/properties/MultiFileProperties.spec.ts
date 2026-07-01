import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { ref } from 'vue';

import { useWorkspaceStore } from '~/stores/workspace.store';

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: vi.fn(() => ({
    vfs: {
      getFile: vi.fn(async (path) => ({ size: 1024 })),
    },
  })),
}));

vi.mock('~/composables/file-conversion/useBatchConversion', () => ({
  useBatchConversion: vi.fn(() => ({
    openModal: vi.fn(),
    state: { isModalOpen: false },
    videoSettings: {},
    audioSettings: {},
    imageSettings: {},
    modalTitle: { value: '' },
    startConversion: vi.fn(),
    cancelConversion: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useBatchAudioExtraction', () => ({
  useBatchAudioExtraction: vi.fn(() => ({
    isExtracting: { value: false },
    batchExtractAudio: vi.fn(),
  })),
}));

describe('MultiFileProperties.vue', () => {
  const mockEntries = [
    { kind: 'file', name: 'video1.mp4', path: '/p/v1.mp4' },
    { kind: 'file', name: 'image1.jpg', path: '/p/i1.jpg' },
    { kind: 'directory', name: 'folder1', path: '/p/f1' },
  ];

  beforeEach(() => {
    const ws = useWorkspaceStore();
    ws.inDevelopmentFeaturesEnabled = true;
    ws.premiumFeaturesEnabled = true;
  });

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
    const findButtonByTitlePrefix = (prefix: string) => {
      return component.findAll('button').find((b) => b.attributes('title')?.startsWith(prefix));
    };
    expect(findButtonByTitlePrefix('common.copy')).toBeTruthy();
    expect(findButtonByTitlePrefix('common.cut')).toBeTruthy();
    expect(findButtonByTitlePrefix('common.delete')).toBeTruthy();
    expect(component.text()).toContain('videoEditor.fileManager.proxy.create');
    expect(component.text()).toContain('videoEditor.fileManager.actions.batchConvertVideo');
    expect(component.text()).toContain('videoEditor.fileManager.actions.batchConvertImages');
    expect(component.text()).toContain('videoEditor.fileManager.actions.batchExtractAudio');
  });
});
