import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useFileBrowserFileActions } from '../~/composables/fileManager/useFileBrowserFileActions';
import type { FsEntry } from '../~/types/fs';

const projectStore = {
  getDirectoryHandleByPath: vi.fn().mockResolvedValue({}),
  goToCut: vi.fn(),
  goToSound: vi.fn(),
  addTextPanel: vi.fn(),
  addMediaPanel: vi.fn(),
};

const uiStore = {
  pendingFsEntryCreateTimeline: null,
  pendingFsEntryCreateMarkdown: null,
  remoteExchangeLocalEntry: null,
  remoteExchangeModalOpen: false,
};

const proxyStore = {
  generatingProxies: [] as string[],
  generateProxiesForFolder: vi.fn(),
  cancelProxyGeneration: vi.fn(),
};

const projectTabs = {
  addFileTab: vi.fn().mockReturnValue('tab-1'),
  setActiveTab: vi.fn(),
};

const audioExtraction = {
  extractAudio: vi.fn().mockResolvedValue(undefined),
};

vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/stores/proxy.store', () => ({ useProxyStore: () => proxyStore }));
vi.mock('~/composables/project/useProjectTabs', () => ({ useProjectTabs: () => projectTabs }));
vi.mock('~/composables/fileManager/useAudioExtraction', () => ({
  useAudioExtraction: () => audioExtraction,
}));
vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: vi.fn((name: string) => (name.endsWith('.mp4') ? 'video' : 'unknown')),
  isOpenableProjectFileName: vi.fn((name: string) => !name.startsWith('.')),
}));

describe('useFileBrowserFileActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uiStore.pendingFsEntryCreateTimeline = null;
    uiStore.pendingFsEntryCreateMarkdown = null;
    uiStore.remoteExchangeLocalEntry = null;
    uiStore.remoteExchangeModalOpen = false;
    proxyStore.generatingProxies = [];
  });

  it('delegates delete batch action directly', async () => {
    const onFileActionBase = vi.fn();
    const { onFileAction } = useFileBrowserFileActions({
      folderEntries: ref([]),
      loadFolderContent: vi.fn(),
      onFileActionBase,
      fileConversion: { openConversionModal: vi.fn() } as any,
      openTranscriptionModal: vi.fn(),
      vfs: {} as any,
    });

    const entries = [{ kind: 'file', name: 'test.mp4', path: 'test.mp4' } as FsEntry];
    await onFileAction('delete', entries);

    expect(onFileActionBase).toHaveBeenCalledWith('delete', entries);
  });

  it('handles createFolder action', async () => {
    const onFileActionBase = vi.fn();
    const loadFolderContent = vi.fn();
    const { onFileAction } = useFileBrowserFileActions({
      folderEntries: ref([{ name: 'existing' } as FsEntry]),
      loadFolderContent,
      onFileActionBase,
      fileConversion: {} as any,
      openTranscriptionModal: vi.fn(),
      vfs: {} as any,
    });

    const entry = { kind: 'directory', name: 'new', path: 'new' } as FsEntry;
    await onFileAction('createFolder', entry);

    expect(onFileActionBase).toHaveBeenCalledWith('createFolder', entry, expect.any(Function));
    const existingNamesFn = onFileActionBase.mock.calls[0][2];
    expect(existingNamesFn()).toEqual(['existing']);
    expect(loadFolderContent).toHaveBeenCalled();
  });

  it('sets pending target for createTimeline', async () => {
    const { onFileAction } = useFileBrowserFileActions({
      folderEntries: ref([]),
      loadFolderContent: vi.fn(),
      onFileActionBase: vi.fn(),
      fileConversion: {} as any,
      openTranscriptionModal: vi.fn(),
      vfs: {} as any,
    });

    const entry = { kind: 'directory', name: 'dir', path: 'dir' } as FsEntry;
    await onFileAction('createTimeline', entry);

    expect(uiStore.pendingFsEntryCreateTimeline).toBe(entry);
  });
});
