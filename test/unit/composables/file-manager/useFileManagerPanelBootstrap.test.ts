import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useFileManagerPanelBootstrap } from '~/composables/fileManager/useFileManagerPanelBootstrap';

const projectStore = {
  currentProjectName: 'Demo Project',
  currentProjectId: 'project-1',
};
const selectionStore = { selectFsEntry: vi.fn() };
const uiStore = {
  restoreFileTreeStateOnce: vi.fn(),
  selectedFsEntry: null as any,
};

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
});
