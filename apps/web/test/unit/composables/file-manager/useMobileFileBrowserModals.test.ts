/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { useMobileFileBrowserModals } from '~/composables/file-manager/useMobileFileBrowserModals';
import type { FsEntry } from '~/types/fs';
import type { MobileDrawerAction } from '~/types/file-manager';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';

const mockToast = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
}));

const addMediaToTimelineMock = vi.hoisted(() => vi.fn());

vi.mock('#ui/composables/useToast', () => ({ useToast: () => mockToast }));
vi.mock('~/composables/timeline/useAddMediaToTimeline', () => ({
  useAddMediaToTimeline: () => ({ addMediaToTimeline: addMediaToTimelineMock }),
}));

const mockProjectStore = reactive({
  setView: vi.fn(),
});

const mockSelectionStore = reactive({
  selectedEntity: null as any,
  clearSelection: vi.fn(),
});

const mockT = (key: string) => key;

vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('#imports', () => ({
  useI18n: () => ({ t: mockT }),
}));

function createEntry(name: string, path: string, kind: 'file' | 'directory' = 'file'): FsEntry {
  return { name, path, kind };
}

function createCompat(status: FileCompatibility['status']): FileCompatibility {
  return { status, format: 'mp4', codecs: [] };
}

describe('useMobileFileBrowserModals', () => {
  const entries = ref<FsEntry[]>([]);
  const compatibility = ref<Record<string, FileCompatibility>>({});
  const isSelectionMode = ref(false);
  const selectedEntries = ref<FsEntry[]>([]);
  const isDrawerOpen = ref(false);
  const closeAllUI = vi.fn();
  const renameEntry = vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn().mockResolvedValue(undefined);
  const onFileAction = vi.fn().mockResolvedValue(undefined);
  const handleDeleteConfirm = vi.fn().mockResolvedValue(undefined);
  const openTranscriptionModal = vi.fn();

  function getComposable() {
    return useMobileFileBrowserModals({
      entries,
      compatibility,
      isSelectionMode,
      selectedEntries,
      isDrawerOpen,
      closeAllUI,
      renameEntry,
      reload,
      onFileAction,
      handleDeleteConfirm,
      openTranscriptionModal,
    });
  }

  beforeEach(() => {
    entries.value = [];
    compatibility.value = {};
    isSelectionMode.value = false;
    selectedEntries.value = [];
    isDrawerOpen.value = false;
    mockSelectionStore.selectedEntity = null;
    addMediaToTimelineMock.mockResolvedValue(true);
    vi.clearAllMocks();
  });

  it('adds selected entity to timeline directly', async () => {
    const entry = createEntry('clip.mp4', 'clip.mp4');
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: 'clip.mp4',
      entry,
    };

    const { handleAddToProject } = getComposable();
    isDrawerOpen.value = true;

    await handleAddToProject();

    expect(addMediaToTimelineMock).toHaveBeenCalledWith([{ name: 'clip.mp4', path: 'clip.mp4' }]);
    expect(isDrawerOpen.value).toBe(false);
    expect(mockToast.add).toHaveBeenCalledWith({
      title: 'common.success',
      description: 'common.addedToTimeline',
      color: 'success',
    });
    expect(closeAllUI).toHaveBeenCalled();
    expect(mockProjectStore.setView).toHaveBeenCalledWith('cut');
  });

  it('does not add to timeline when selected entity is not a file-manager file', async () => {
    mockSelectionStore.selectedEntity = { source: 'timeline', kind: 'clip' };

    const { handleAddToProject } = getComposable();
    await handleAddToProject();

    expect(addMediaToTimelineMock).not.toHaveBeenCalled();
  });

  it('adds only supported selection entries to timeline directly', async () => {
    const supported = createEntry('clip.mp4', 'clip.mp4');
    const unsupported = createEntry('clip.mp4', 'unsupported.mp4');
    isSelectionMode.value = true;
    selectedEntries.value = [supported, unsupported];
    compatibility.value = { 'unsupported.mp4': createCompat('fully_unsupported') };

    const { handleAddSelectionToTimeline } = getComposable();
    isDrawerOpen.value = true;

    await handleAddSelectionToTimeline();

    expect(addMediaToTimelineMock).toHaveBeenCalledWith([{ name: 'clip.mp4', path: 'clip.mp4' }]);
    expect(isDrawerOpen.value).toBe(false);
  });

  it('does not add selection to timeline when no supported entries', async () => {
    const unsupported = createEntry('file.bin', 'file.bin');
    isSelectionMode.value = true;
    selectedEntries.value = [unsupported];

    const { handleAddSelectionToTimeline } = getComposable();
    await handleAddSelectionToTimeline();

    expect(addMediaToTimelineMock).not.toHaveBeenCalled();
  });

  it('computes canAddSelectionToTimeline correctly', () => {
    const supported = createEntry('clip.mp4', 'clip.mp4');
    isSelectionMode.value = true;
    selectedEntries.value = [supported];

    const { canAddSelectionToTimeline } = getComposable();
    expect(canAddSelectionToTimeline.value).toBe(true);

    selectedEntries.value = [createEntry('file.bin', 'file.bin')];
    expect(canAddSelectionToTimeline.value).toBe(false);
  });

  it('does not expose text files as addable to timeline in selection mode', () => {
    isSelectionMode.value = true;
    selectedEntries.value = [createEntry('notes.txt', 'notes.txt')];

    const { canAddSelectionToTimeline } = getComposable();

    expect(canAddSelectionToTimeline.value).toBe(false);
  });

  it('opens rename modal and validates names', async () => {
    entries.value = [createEntry('foo.mp4', 'a/foo.mp4'), createEntry('bar.mp4', 'a/bar.mp4')];

    const { handleRename, isRenameModalOpen, entryToRename, validateRename } = getComposable();
    await handleRename(entries.value[0]!);

    expect(isRenameModalOpen.value).toBe(true);
    expect(entryToRename.value).toBe(entries.value[0]);

    expect(validateRename('foo.mp4')).toBe(true);
    expect(validateRename('bar.mp4')).toBe('common.validation.exists');
    expect(validateRename('  ')).toBe(false);
  });

  it('uses custom validateRename when provided', () => {
    const customValidate = vi.fn().mockReturnValue('custom-error');
    const composable = useMobileFileBrowserModals({
      entries,
      compatibility,
      isSelectionMode,
      selectedEntries,
      isDrawerOpen,
      closeAllUI,
      renameEntry,
      reload,
      onFileAction,
      handleDeleteConfirm,
      openTranscriptionModal,
      validateRename: customValidate,
    });

    expect(composable.validateRename('x')).toBe('custom-error');
    expect(customValidate).toHaveBeenCalledWith('x');
  });

  it('renames entry and reloads on confirm', async () => {
    entries.value = [createEntry('foo.mp4', 'a/foo.mp4')];

    const { handleRename, onRenameConfirm } = getComposable();
    await handleRename(entries.value[0]!);
    await onRenameConfirm('renamed.mp4');

    expect(renameEntry).toHaveBeenCalledWith(entries.value[0], 'renamed.mp4');
    expect(reload).toHaveBeenCalled();
    expect(mockToast.add).toHaveBeenCalledWith({
      title: 'common.success',
      description: 'common.saveSuccess',
      color: 'success',
    });
  });

  it('shows error toast when rename fails', async () => {
    entries.value = [createEntry('foo.mp4', 'a/foo.mp4')];
    renameEntry.mockRejectedValueOnce(new Error('rename failed'));

    const { handleRename, onRenameConfirm } = getComposable();
    await handleRename(entries.value[0]!);
    await onRenameConfirm('renamed.mp4');

    expect(mockToast.add).toHaveBeenCalledWith({
      title: 'common.error',
      description: 'rename failed',
      color: 'error',
    });
  });

  it('skips rename when new name is unchanged', async () => {
    entries.value = [createEntry('foo.mp4', 'a/foo.mp4')];

    const { handleRename, onRenameConfirm } = getComposable();
    await handleRename(entries.value[0]!);
    await onRenameConfirm('foo.mp4');

    expect(renameEntry).not.toHaveBeenCalled();
  });

  it('handles rename drawer action', async () => {
    entries.value = [createEntry('foo.mp4', 'a/foo.mp4')];

    const { handleDrawerAction, isRenameModalOpen, entryToRename } = getComposable();
    await handleDrawerAction('rename', entries.value[0]!);

    expect(isRenameModalOpen.value).toBe(true);
    expect(entryToRename.value).toBe(entries.value[0]);
    expect(closeAllUI).toHaveBeenCalled();
  });

  it('handles transcribe drawer action', async () => {
    const entry = createEntry('foo.mp4', 'a/foo.mp4');

    const { handleDrawerAction } = getComposable();
    await handleDrawerAction('transcribe', entry);

    expect(openTranscriptionModal).toHaveBeenCalledWith(entry);
    expect(closeAllUI).toHaveBeenCalled();
  });

  it('closes UI on copy/cut/delete drawer actions', async () => {
    const { handleDrawerAction } = getComposable();

    await handleDrawerAction('copy', createEntry('foo.mp4', 'a/foo.mp4'));
    expect(closeAllUI).toHaveBeenCalledTimes(1);
    await handleDrawerAction('cut', createEntry('foo.mp4', 'a/foo.mp4'));
    expect(closeAllUI).toHaveBeenCalledTimes(2);
    await handleDrawerAction('delete', createEntry('foo.mp4', 'a/foo.mp4'));
    expect(closeAllUI).toHaveBeenCalledTimes(3);
  });

  it('delegates unknown drawer actions to onFileAction', async () => {
    const { handleDrawerAction } = getComposable();
    const entry = createEntry('foo.mp4', 'a/foo.mp4');

    await handleDrawerAction('info' as MobileDrawerAction, entry);

    expect(onFileAction).toHaveBeenCalledWith('info', entry);
  });

  it('confirms deletion and closes UI', async () => {
    const { wrappedHandleDeleteConfirm } = getComposable();
    await wrappedHandleDeleteConfirm();

    expect(handleDeleteConfirm).toHaveBeenCalled();
    expect(closeAllUI).toHaveBeenCalled();
  });
});
