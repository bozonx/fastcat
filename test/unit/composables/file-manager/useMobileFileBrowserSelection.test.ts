import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { useMobileFileBrowserSelection } from '~/composables/fileManager/useMobileFileBrowserSelection';

// --- Mocks ---

const mockSelectionStore = reactive({
  selectedEntity: null as any,
  selectFsEntry: vi.fn((entry) => {
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: entry.kind,
      path: entry.path,
      name: entry.name,
      entry,
    };
  }),
  selectFsEntries: vi.fn((entries) => {
    if (entries.length === 0) {
      mockSelectionStore.selectedEntity = null;
    } else if (entries.length === 1) {
      mockSelectionStore.selectFsEntry(entries[0]);
    } else {
      mockSelectionStore.selectedEntity = {
        source: 'fileManager',
        kind: 'multiple',
        entries,
      };
    }
  }),
  clearSelection: vi.fn(() => {
    mockSelectionStore.selectedEntity = null;
  }),
});

const mockFilesPageStore = reactive({
  folderSizes: {} as Record<string, number>,
  openFolder: vi.fn(),
});

const mockProjectStore = reactive({
  getDirectoryHandleByPath: vi.fn(),
  openTimelineFile: vi.fn(),
  setView: vi.fn(),
});

vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => mockFilesPageStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));

describe('useMobileFileBrowserSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
    mockFilesPageStore.folderSizes = {};
  });

  it('toggles selection mode', () => {
    const { isSelectionMode, toggleSelectionMode } = useMobileFileBrowserSelection();
    
    expect(isSelectionMode.value).toBe(false);
    toggleSelectionMode();
    expect(isSelectionMode.value).toBe(true);
    
    toggleSelectionMode();
    expect(isSelectionMode.value).toBe(false);
    expect(mockSelectionStore.clearSelection).toHaveBeenCalled();
  });

  it('handles long press to activate selection mode', () => {
    const { isSelectionMode, handleLongPress } = useMobileFileBrowserSelection();
    const entry = { name: 'file.txt', kind: 'file', path: 'file.txt' } as any;

    handleLongPress(entry);
    expect(isSelectionMode.value).toBe(true);
    expect(mockSelectionStore.selectFsEntry).toHaveBeenCalledWith(entry);
  });

  it('toggles selection of entries', () => {
    const { handleToggleSelection, selectedEntries } = useMobileFileBrowserSelection();
    const entry1 = { name: '1.txt', kind: 'file', path: '1.txt' } as any;
    const entry2 = { name: '2.txt', kind: 'file', path: '2.txt' } as any;

    handleToggleSelection(entry1);
    expect(mockSelectionStore.selectFsEntries).toHaveBeenCalledWith([entry1]);
    
    // Simulate store update
    mockSelectionStore.selectedEntity = { source: 'fileManager', kind: 'file', entry: entry1 } as any;
    
    handleToggleSelection(entry2);
    expect(mockSelectionStore.selectFsEntries).toHaveBeenCalledWith([entry1, entry2]);
  });

  it('calculates total selected size correctly', () => {
    const { totalSelectedSize } = useMobileFileBrowserSelection();
    const file1 = { name: '1.txt', kind: 'file', path: '1.txt', size: 100 } as any;
    const folder = { name: 'dir', kind: 'directory', path: 'dir' } as any;
    
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'multiple',
      entries: [file1, folder],
    } as any;
    
    mockFilesPageStore.folderSizes['dir'] = 500;
    
    expect(totalSelectedSize.value).toBe(600);
  });

  it('handles entry click correctly in normal mode (folder)', () => {
    const { handleEntryClick } = useMobileFileBrowserSelection();
    const folder = { name: 'Videos', kind: 'directory', path: 'videos' } as any;

    handleEntryClick(folder);
    expect(mockFilesPageStore.openFolder).toHaveBeenCalledWith(folder);
  });

  it('handles entry click correctly in selection mode', () => {
    const { handleEntryClick, isSelectionMode } = useMobileFileBrowserSelection();
    const file = { name: 'file.txt', kind: 'file', path: 'file.txt' } as any;
    
    isSelectionMode.value = true;
    handleEntryClick(file);
    
    expect(mockSelectionStore.selectFsEntries).toHaveBeenCalledWith([file]);
  });
});
