/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { useFileManagerPanelBootstrap } from '~/composables/file-manager/useFileManagerPanelBootstrap';

const projectStore = {
  currentProjectName: 'Demo Project',
  currentProjectId: 'project-1',
};
const selectionStore = { selectFsEntry: vi.fn() };
const uiStore = reactive({
  restoreFileTreeStateOnce: vi.fn(),
  selectedFsEntry: null as any,
  fileManagerUpdateCounter: 0,
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => selectionStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStore,
}));

describe('useFileManagerPanelBootstrap', () => {
  beforeEach(() => {
    projectStore.currentProjectName = 'Demo Project';
    selectionStore.selectFsEntry.mockClear();
    uiStore.restoreFileTreeStateOnce.mockClear();
    uiStore.selectedFsEntry = null;
    uiStore.fileManagerUpdateCounter = 0;
  });

  it('loads project directory and selects root entry on immediate watch', async () => {
    const loadProjectDirectory = vi.fn().mockResolvedValue(undefined);
    const onRootEntrySelected = vi.fn();

    useFileManagerPanelBootstrap({
      loadProjectDirectory,
      onRootEntrySelected,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(uiStore.restoreFileTreeStateOnce).toHaveBeenCalledTimes(1);
    expect(loadProjectDirectory).toHaveBeenCalledTimes(1);
    expect(uiStore.selectedFsEntry).toEqual({
      kind: 'directory',
      name: 'Demo Project',
      path: '',
    });
    expect(selectionStore.selectFsEntry).toHaveBeenCalledWith(uiStore.selectedFsEntry);
    expect(onRootEntrySelected).toHaveBeenCalledWith(uiStore.selectedFsEntry);
  });

  it('fully refreshes the tree after a global file manager update without notifying again', async () => {
    const loadProjectDirectory = vi.fn().mockResolvedValue(undefined);

    useFileManagerPanelBootstrap({
      loadProjectDirectory,
      onRootEntrySelected: vi.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    loadProjectDirectory.mockClear();

    uiStore.fileManagerUpdateCounter++;
    await nextTick();

    expect(loadProjectDirectory).toHaveBeenCalledWith({
      fullRefresh: true,
      suppressNotification: true,
    });
  });
});
