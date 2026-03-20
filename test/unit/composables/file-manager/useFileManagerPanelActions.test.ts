import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileManagerPanelActions } from '../~/composables/fileManager/useFileManagerPanelActions';
import type { FsEntry } from '../~/types/fs';

const { createTimelineCommand } = vi.hoisted(() => ({
  createTimelineCommand: vi.fn(),
}));

const projectStore = {
  currentProjectName: 'Demo Project',
  openTimelineFile: vi.fn().mockResolvedValue(undefined),
  loadTimelineMetadata: vi.fn(),
  goToCut: vi.fn(),
  goToSound: vi.fn(),
  addTextPanel: vi.fn(),
  addMediaPanel: vi.fn(),
  getDirectoryHandleByPath: vi.fn().mockResolvedValue({ kind: 'directory' }),
};

const timelineStore = {
  loadTimeline: vi.fn().mockResolvedValue(undefined),
  loadTimelineMetadata: vi.fn(),
};

const selectionStore = {
  selectFsEntry: vi.fn(),
};

const proxyStore = {
  generatingProxies: [] as string[],
  generateProxiesForFolder: vi.fn(),
  cancelProxyGeneration: vi.fn(),
};

const uiStore = {
  selectedFsEntry: null as any,
  setFileTreePathExpanded: vi.fn(),
  remoteExchangeLocalEntry: null as any,
  remoteExchangeModalOpen: false,
};

vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));
vi.mock('~/stores/proxy.store', () => ({ useProxyStore: () => proxyStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/file-manager/application/fileManagerCommands', () => ({ createTimelineCommand }));
vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: vi.fn(() => 'video'),
  isOpenableProjectFileName: vi.fn(() => true),
}));

vi.stubGlobal('useToast', () => ({ add: vi.fn() }));

describe('useFileManagerPanelActions', () => {
  beforeEach(() => {
    createTimelineCommand.mockReset();
    projectStore.openTimelineFile.mockClear();
    timelineStore.loadTimeline.mockClear();
    timelineStore.loadTimelineMetadata.mockClear();
    selectionStore.selectFsEntry.mockClear();
    uiStore.selectedFsEntry = null;
    uiStore.setFileTreePathExpanded.mockClear();
    uiStore.remoteExchangeLocalEntry = null;
    uiStore.remoteExchangeModalOpen = false;
  });

  it('creates timeline in directory and selects created entry', async () => {
    const createdEntry: FsEntry = {
      kind: 'file',
      name: 'demo.otio',
      path: 'timelines/demo.otio',
    };
    createTimelineCommand.mockResolvedValue('timelines/demo.otio');

    const actions = useFileManagerPanelActions({
      vfs: { readFile: vi.fn() },
      loadProjectDirectory: vi.fn().mockResolvedValue(undefined),
      reloadDirectory: vi.fn().mockResolvedValue(undefined),
      findEntryByPath: vi.fn().mockReturnValue(createdEntry),
      onFileActionBase: vi.fn(),
      handleConvert: vi.fn(),
      openTranscriptionModal: vi.fn(),
      extractAudio: vi.fn().mockResolvedValue(undefined),
      addFileTab: vi.fn(),
      setActiveTab: vi.fn(),
      onSelect: vi.fn(),
    });

    await actions.createTimelineInDirectory({
      kind: 'directory',
      name: 'timelines',
      path: 'timelines',
    });

    expect(createTimelineCommand).toHaveBeenCalledTimes(1);
    expect(selectionStore.selectFsEntry).toHaveBeenCalledWith(createdEntry);
    expect(uiStore.selectedFsEntry).toEqual({
      kind: 'file',
      name: 'demo.otio',
      path: 'timelines/demo.otio',
    });
    expect(projectStore.openTimelineFile).toHaveBeenCalledWith('timelines/demo.otio');
    expect(timelineStore.loadTimeline).toHaveBeenCalledTimes(1);
  });

  it('delegates createFolder with existing names callback', async () => {
    const onFileActionBase = vi.fn();
    const actions = useFileManagerPanelActions({
      vfs: { readFile: vi.fn() },
      loadProjectDirectory: vi.fn().mockResolvedValue(undefined),
      reloadDirectory: vi.fn().mockResolvedValue(undefined),
      findEntryByPath: vi.fn().mockReturnValue(null),
      onFileActionBase,
      handleConvert: vi.fn(),
      openTranscriptionModal: vi.fn(),
      extractAudio: vi.fn().mockResolvedValue(undefined),
      addFileTab: vi.fn(),
      setActiveTab: vi.fn(),
      onSelect: vi.fn(),
    });

    await actions.handleFileAction('createFolder', {
      kind: 'directory',
      name: 'assets',
      path: 'assets',
      children: [{ kind: 'file', name: 'a.txt', path: 'assets/a.txt' } as FsEntry],
    });

    expect(uiStore.setFileTreePathExpanded).toHaveBeenCalledWith('assets', true);
    expect(onFileActionBase).toHaveBeenCalledWith(
      'createFolder',
      expect.objectContaining({ path: 'assets' }),
      expect.any(Function),
    );
    const getExistingNames = onFileActionBase.mock.calls[0][2];
    expect(getExistingNames()).toEqual(['a.txt']);
  });
});
