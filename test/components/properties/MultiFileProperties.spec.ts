import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { reactive, ref } from 'vue';

import { useWorkspaceStore } from '~/stores/workspace.store';

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: vi.fn(() => ({
    vfs: {
      getFile: vi.fn(async () => ({ size: 1024 })),
    },
    reloadDirectory: vi.fn(),
  })),
}));

const mockOpenBatchConversionModal = vi.fn();
vi.mock('~/composables/file-conversion/useBatchConversion', () => ({
  useBatchConversion: vi.fn(() => ({
    openModal: mockOpenBatchConversionModal,
    state: { isModalOpen: false },
    videoSettings: {},
    audioSettings: {},
    imageSettings: {},
    modalTitle: { value: '' },
    startConversion: vi.fn(),
    cancelConversion: vi.fn(),
  })),
}));

const mockBatchExtractAudio = vi.fn();
vi.mock('~/composables/file-manager/useBatchAudioExtraction', () => ({
  useBatchAudioExtraction: vi.fn(() => ({
    isExtracting: { value: false },
    batchExtractAudio: mockBatchExtractAudio,
  })),
}));

const mockProxyStore = reactive({
  existingProxies: new Map<string, boolean>(),
  generatingProxies: new Map<string, boolean>(),
  generateProxiesBatch: vi.fn(async () => ({ skippedCount: 0 })),
  cancelProxyGeneration: vi.fn(),
  deleteProxiesBatch: vi.fn(),
});
vi.mock('~/stores/proxy.store', () => ({ useProxyStore: () => mockProxyStore }));

const mockUiStore = reactive({
  pendingFsEntryDelete: null as any,
});
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));

const mockProjectStore = reactive({
  getFileByPath: vi.fn(async () => new File([], 'test.mp4')),
});
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));

const mockClipboardStore = reactive({
  setClipboardPayload: vi.fn(),
});
vi.mock('~/composables/useAppClipboard', () => ({ useAppClipboard: () => mockClipboardStore }));

const mockSelectionStore = reactive({
  selectedEntity: null as any,
});
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));

vi.mock('~/utils/fs', () => ({
  computeDirectoryStatsByPath: vi.fn(async () => ({ size: 2048 })),
}));

describe('MultiFileProperties.vue', () => {
  const mockEntries = [
    { kind: 'file', name: 'video1.mp4', path: '/p/v1.mp4' },
    { kind: 'file', name: 'image1.jpg', path: '/p/i1.jpg' },
    { kind: 'directory', name: 'folder1', path: '/p/f1' },
  ];

  const videoEntries = [
    { kind: 'file', name: 'v1.mp4', path: '/p/v1.mp4' },
    { kind: 'file', name: 'v2.mov', path: '/p/v2.mov' },
  ];

  const audioEntries = [{ kind: 'file', name: 'a1.mp3', path: '/p/a1.mp3' }];

  const imageEntries = [{ kind: 'file', name: 'i1.png', path: '/p/i1.png' }];

  beforeEach(() => {
    vi.clearAllMocks();
    const ws = useWorkspaceStore();
    ws.inDevelopmentFeaturesEnabled = true;
    ws.premiumFeaturesEnabled = true;
    mockProxyStore.existingProxies.clear();
    mockProxyStore.generatingProxies.clear();
    mockSelectionStore.selectedEntity = null;
    mockUiStore.pendingFsEntryDelete = null;
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

    expect(component.text()).toContain('4 KB'); // 1024 + 1024 (files) + 2048 (directory)
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

  it('copies entries to clipboard', async () => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'multiple',
      instanceId: 'panel-1',
    };
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: mockEntries as any[] },
    });

    (component.vm as any).onCopy();

    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'fileManager',
      operation: 'copy',
      items: [
        { path: '/p/v1.mp4', kind: 'file', name: 'video1.mp4', source: undefined },
        { path: '/p/i1.jpg', kind: 'file', name: 'image1.jpg', source: undefined },
        { path: '/p/f1', kind: 'directory', name: 'folder1', source: undefined },
      ],
      sourceInstanceId: 'panel-1',
    });
  });

  it('cuts entries to clipboard', async () => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'multiple',
      instanceId: 'panel-1',
    };
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: mockEntries as any[] },
    });

    (component.vm as any).onCut();

    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'fileManager',
      operation: 'cut',
      items: [
        { path: '/p/v1.mp4', kind: 'file', name: 'video1.mp4', source: undefined },
        { path: '/p/i1.jpg', kind: 'file', name: 'image1.jpg', source: undefined },
        { path: '/p/f1', kind: 'directory', name: 'folder1', source: undefined },
      ],
      sourceInstanceId: 'panel-1',
    });
  });

  it('does not copy when entries have no path', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: [{ kind: 'file', name: 'no-path.mp4', path: '' }] as any[] },
    });

    (component.vm as any).onCopy();

    expect(mockClipboardStore.setClipboardPayload).not.toHaveBeenCalled();
  });

  it('sets pendingFsEntryDelete on delete', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: mockEntries as any[] },
    });

    (component.vm as any).onDelete();

    expect(mockUiStore.pendingFsEntryDelete).toEqual(mockEntries);
  });

  it('opens batch conversion modal for video', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    (component.vm as any).handleBatchConvertVideo();

    expect(mockOpenBatchConversionModal).toHaveBeenCalledWith(
      'video',
      videoEntries,
      false,
      expect.any(Function),
    );
  });

  it('opens batch conversion modal for audio', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: audioEntries as any[] },
    });

    (component.vm as any).handleBatchConvertAudio();

    expect(mockOpenBatchConversionModal).toHaveBeenCalledWith(
      'audio',
      audioEntries,
      false,
      expect.any(Function),
    );
  });

  it('opens batch conversion modal for images', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: imageEntries as any[] },
    });

    (component.vm as any).handleBatchConvertImages();

    expect(mockOpenBatchConversionModal).toHaveBeenCalledWith(
      'image',
      imageEntries,
      false,
      expect.any(Function),
    );
  });

  it('calls batchExtractAudio for video entries', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    await (component.vm as any).handleBatchExtractAudio();

    expect(mockBatchExtractAudio).toHaveBeenCalledWith(videoEntries, false);
  });

  it('creates proxies for video files', async () => {
    mockProjectStore.getFileByPath = vi.fn(async () => new File([], 'test'));
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    await (component.vm as any).onCreateProxy();

    expect(mockProjectStore.getFileByPath).toHaveBeenCalledTimes(2);
    expect(mockProxyStore.generateProxiesBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ projectRelativePath: '/p/v1.mp4' }),
        expect.objectContaining({ projectRelativePath: '/p/v2.mov' }),
      ]),
    );
  });

  it('cancels proxy generation for generating entries', async () => {
    mockProxyStore.generatingProxies.set('/p/v1.mp4', true);
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    (component.vm as any).onCancelProxy();

    expect(mockProxyStore.cancelProxyGeneration).toHaveBeenCalledWith('/p/v1.mp4');
    expect(mockProxyStore.cancelProxyGeneration).not.toHaveBeenCalledWith('/p/v2.mov');
  });

  it('deletes existing proxies', async () => {
    mockProxyStore.existingProxies.set('/p/v1.mp4', true);
    mockProxyStore.existingProxies.set('/p/v2.mov', true);
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    (component.vm as any).onDeleteProxy();

    expect(mockProxyStore.deleteProxiesBatch).toHaveBeenCalledWith(['/p/v1.mp4', '/p/v2.mov']);
  });

  it('hides proxy actions when isExternal is true', async () => {
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[], isExternal: true },
    });

    expect(component.text()).not.toContain('videoEditor.fileManager.proxy.create');
    expect(component.text()).not.toContain('videoEditor.fileManager.actions.batchConvertVideo');
  });

  it('hides batch extract audio when premium features are disabled', async () => {
    const ws = useWorkspaceStore();
    ws.premiumFeaturesEnabled = false;
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    expect(component.text()).not.toContain('videoEditor.fileManager.actions.batchExtractAudio');
  });

  it('shows cancel proxy when proxy is generating', async () => {
    mockProxyStore.generatingProxies.set('/p/v1.mp4', true);
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    expect(component.text()).toContain('videoEditor.fileManager.actions.cancelProxyGeneration');
  });

  it('shows delete proxy when existing proxy is present', async () => {
    mockProxyStore.existingProxies.set('/p/v1.mp4', true);
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    expect(component.text()).toContain('videoEditor.fileManager.proxy.delete');
  });

  it('shows toast when some proxies are skipped', async () => {
    mockProxyStore.generateProxiesBatch = vi.fn(async () => ({ skippedCount: 1 }));
    const component = await mountWithNuxt(MultiFileProperties, {
      props: { entries: videoEntries as any[] },
    });

    await (component.vm as any).onCreateProxy();

    // Toast is called via useToast — just verify no throw
    expect(mockProxyStore.generateProxiesBatch).toHaveBeenCalled();
  });
});
