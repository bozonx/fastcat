import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

import { useFileBrowserInteraction } from '~/composables/fileManager/useFileBrowserInteraction';
import type { FsEntry } from '~/types/fs';

const filesPageStore = {
  sortOption: { field: 'name', order: 'asc' },
  columnWidths: {} as Record<string, number>,
  setSortOption: vi.fn((option) => {
    filesPageStore.sortOption = option;
  }),
  setColumnWidth: vi.fn(),
  selectFile: vi.fn(),
  openFolder: vi.fn(),
};

const projectStore = {
  openTimelineFile: vi.fn().mockResolvedValue(undefined),
};

const timelineStore = {
  loadTimeline: vi.fn().mockResolvedValue(undefined),
  loadTimelineMetadata: vi.fn(),
};

vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => filesPageStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));
vi.mock('~/utils/media-types', () => ({
  isOpenableProjectFileName: vi.fn((name: string) => name.endsWith('.txt')),
}));
vi.mock('~/composables/fileManager/useFileManagerSelection', () => ({
  useFileManagerSelection: ({ onSingleSelect }: any) => ({
    handleEntryClick: (e: any, entry: any) => onSingleSelect(entry),
  }),
}));

describe('useFileBrowserInteraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filesPageStore.sortOption = { field: 'name', order: 'asc' };
  });

  it('handleSort toggles order if same field, sets asc if new field', () => {
    const { handleSort } = useFileBrowserInteraction({
      isRemoteMode: ref(false),
      remoteCurrentFolder: ref(null),
      sortedEntries: ref([]),
      loadFolderContent: vi.fn(),
      loadParentFolders: vi.fn(),
      setSelectedFsEntry: vi.fn(),
      onFileAction: vi.fn(),
    });

    handleSort('name'); // already name asc -> desc
    expect(filesPageStore.sortOption).toEqual({ field: 'name', order: 'desc' });

    handleSort('size'); // new field -> asc
    expect(filesPageStore.sortOption).toEqual({ field: 'size', order: 'asc' });
  });

  it('handleEntryDoubleClick opens folder in local mode', () => {
    const { handleEntryDoubleClick } = useFileBrowserInteraction({
      isRemoteMode: ref(false),
      remoteCurrentFolder: ref(null),
      sortedEntries: ref([]),
      loadFolderContent: vi.fn(),
      loadParentFolders: vi.fn(),
      setSelectedFsEntry: vi.fn(),
      onFileAction: vi.fn(),
    });

    handleEntryDoubleClick({ kind: 'directory', name: 'dir', path: 'dir' } as FsEntry);
    expect(filesPageStore.openFolder).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'dir' }),
    );
  });

  it('handleEntryDoubleClick opens timeline if .otio', async () => {
    const { handleEntryDoubleClick } = useFileBrowserInteraction({
      isRemoteMode: ref(false),
      remoteCurrentFolder: ref(null),
      sortedEntries: ref([]),
      loadFolderContent: vi.fn(),
      loadParentFolders: vi.fn(),
      setSelectedFsEntry: vi.fn(),
      onFileAction: vi.fn(),
    });

    handleEntryDoubleClick({ kind: 'file', name: 'test.otio', path: 'test.otio' } as FsEntry);
    await Promise.resolve(); // let async IIFE run

    expect(projectStore.openTimelineFile).toHaveBeenCalledWith('test.otio');
    expect(timelineStore.loadTimeline).toHaveBeenCalled();
  });

  it('handleEntryDoubleClick triggers openAsProjectTab for openable text files', () => {
    const onFileAction = vi.fn();
    const { handleEntryDoubleClick } = useFileBrowserInteraction({
      isRemoteMode: ref(false),
      remoteCurrentFolder: ref(null),
      sortedEntries: ref([]),
      loadFolderContent: vi.fn(),
      loadParentFolders: vi.fn(),
      setSelectedFsEntry: vi.fn(),
      onFileAction,
    });

    handleEntryDoubleClick({ kind: 'file', name: 'script.txt', path: 'script.txt' } as FsEntry);
    expect(onFileAction).toHaveBeenCalledWith(
      'openAsProjectTab',
      expect.objectContaining({ name: 'script.txt' }),
    );
  });
});
