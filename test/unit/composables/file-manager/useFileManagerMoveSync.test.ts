/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

import { useFileManagerMoveSync } from '~/composables/file-manager/useFileManagerMoveSync';
import type { FsEntry } from '~/types/fs';

const uiStore = { selectedFsEntry: null as Record<string, unknown> | null };
const focusStore = {
  setTempFocus: vi.fn(),
  activeTimelinePath: null as string | null,
  setActiveTimelinePath: vi.fn((p: string) => {
    focusStore.activeTimelinePath = p;
  }),
  mainFocusByTimeline: {} as Record<string, unknown>,
};
const selectionStore = {
  selectedEntity: null as Record<string, unknown> | null,
  selectFsEntry: vi.fn(),
};
const projectStore = {
  currentTimelinePath: null as string | null,
  currentFileName: '',
  projectSettings: {
    timelines: {
      openPaths: [] as string[],
      sessions: {} as Record<string, unknown>,
    },
  },
};
const projectTabsStore = { fileTabs: [] as { filePath: string }[] };

vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => focusStore }));
vi.mock('~/stores/project-tabs.store', () => ({ useProjectTabsStore: () => projectTabsStore }));

beforeEach(() => {
  uiStore.selectedFsEntry = null;
  focusStore.activeTimelinePath = null;
  focusStore.mainFocusByTimeline = {};
  selectionStore.selectedEntity = null;
  projectStore.currentTimelinePath = null;
  projectStore.currentFileName = '';
  projectStore.projectSettings.timelines = { openPaths: [], sessions: {} };
  projectTabsStore.fileTabs = [];
  vi.clearAllMocks();
});

describe('useFileManagerMoveSync', () => {
  describe('syncTimelinePathsOnMove', () => {
    it('repoints all timeline references when a timeline file is renamed', async () => {
      projectStore.currentTimelinePath = 'project/old.otio';
      projectStore.projectSettings.timelines.openPaths = ['project/old.otio', 'project/keep.otio'];
      projectStore.projectSettings.timelines.sessions = { 'project/old.otio': { zoom: 1 } };
      focusStore.activeTimelinePath = 'project/old.otio';
      focusStore.mainFocusByTimeline = { 'project/old.otio': 'timeline' };
      projectTabsStore.fileTabs = [{ filePath: 'project/old.otio' }];

      const { syncTimelinePathsOnMove } = useFileManagerMoveSync(ref<FsEntry[]>([]));
      await syncTimelinePathsOnMove({ oldPath: 'project/old.otio', newPath: 'project/new.otio' });

      expect(projectStore.currentTimelinePath).toBe('project/new.otio');
      expect(projectStore.currentFileName).toBe('new.otio');
      expect(projectStore.projectSettings.timelines.openPaths).toEqual([
        'project/new.otio',
        'project/keep.otio',
      ]);
      expect(projectStore.projectSettings.timelines.sessions).toEqual({
        'project/new.otio': { zoom: 1 },
      });
      expect(focusStore.setActiveTimelinePath).toHaveBeenCalledWith('project/new.otio');
      expect(focusStore.mainFocusByTimeline).toEqual({ 'project/new.otio': 'timeline' });
      expect(projectTabsStore.fileTabs[0].filePath).toBe('project/new.otio');
    });

    it('remaps nested paths when a directory is moved', async () => {
      projectStore.projectSettings.timelines.openPaths = ['videos/sub/a.otio', 'audio/b.otio'];

      const { syncTimelinePathsOnMove } = useFileManagerMoveSync(ref<FsEntry[]>([]));
      await syncTimelinePathsOnMove({ oldPath: 'videos', newPath: 'media' });

      expect(projectStore.projectSettings.timelines.openPaths).toEqual([
        'media/sub/a.otio',
        'audio/b.otio',
      ]);
    });

    it('leaves unrelated paths untouched', async () => {
      projectStore.currentTimelinePath = 'project/other.otio';

      const { syncTimelinePathsOnMove } = useFileManagerMoveSync(ref<FsEntry[]>([]));
      await syncTimelinePathsOnMove({ oldPath: 'project/old.otio', newPath: 'project/new.otio' });

      expect(projectStore.currentTimelinePath).toBe('project/other.otio');
    });
  });

  describe('updateSelectionPath', () => {
    it('repoints the selected UI entry to the new path', () => {
      uiStore.selectedFsEntry = { path: 'project/old.otio', name: 'old.otio' };

      const { updateSelectionPath } = useFileManagerMoveSync(ref<FsEntry[]>([]));
      updateSelectionPath({ oldPath: 'project/old.otio', newPath: 'project/new.otio' });

      expect(uiStore.selectedFsEntry).toMatchObject({
        path: 'project/new.otio',
        name: 'new.otio',
      });
      expect(focusStore.setTempFocus).toHaveBeenCalledWith('files-sidebar');
    });

    it('does nothing when the selected entry is a different path', () => {
      uiStore.selectedFsEntry = { path: 'project/other.otio', name: 'other.otio' };

      const { updateSelectionPath } = useFileManagerMoveSync(ref<FsEntry[]>([]));
      updateSelectionPath({ oldPath: 'project/old.otio', newPath: 'project/new.otio' });

      expect(uiStore.selectedFsEntry).toMatchObject({ path: 'project/other.otio' });
      expect(focusStore.setTempFocus).not.toHaveBeenCalled();
    });
  });
});
