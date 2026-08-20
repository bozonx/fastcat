import type { Ref } from 'vue';

import { useUiStore } from '~/stores/ui.store';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFocusStore, type MainPanelFocus } from '~/stores/focus.store';
import { findEntryByPath as findEntryByPathCore } from '~/file-manager/core/tree';
import { getWorkspacePathFileName, getWorkspacePathParent } from '~/utils/workspace-common';
import type { FsEntry } from '~/types/fs';

/**
 * After a file or directory is moved/renamed, the old path lingers in several
 * places: the current UI/selection, the timeline session bookkeeping, open
 * tabs and focus state. This composable repoints all of those to the new path.
 */
export function useFileManagerMoveSync(rootEntries: Ref<FsEntry[]>) {
  const uiStore = useUiStore();
  const projectStore = useProjectStore();
  const selectionStore = useSelectionStore();
  const focusStore = useFocusStore();

  function updateSelectionPath(params: { oldPath: string; newPath: string }) {
    if (uiStore.selectedFsEntry?.path === params.oldPath) {
      uiStore.selectedFsEntry = {
        ...uiStore.selectedFsEntry,
        path: params.newPath,
        name: getWorkspacePathFileName(params.newPath) || uiStore.selectedFsEntry.name,
      };
      focusStore.setTempFocus('files-sidebar');
    }

    const selected = selectionStore.selectedEntity;
    if (selected && selected.source === 'fileManager') {
      if (selected.kind === 'multiple') {
        const nextEntries = selected.entries.map((entry) => {
          if (entry.path === params.oldPath) {
            return {
              ...entry,
              path: params.newPath,
              name: getWorkspacePathFileName(params.newPath) || entry.name,
            };
          }
          return entry;
        });
        selectionStore.selectedEntity = {
          ...selected,
          entries: nextEntries,
        };
      } else if ('path' in selected && selected.path === params.oldPath) {
        const updatedEntry = findEntryByPathCore(rootEntries.value, params.newPath);
        if (updatedEntry) {
          selectionStore.selectFsEntry(updatedEntry, selected.instanceId, selected.isExternal);
        } else {
          const nextEntry: FsEntry = {
            ...selected.entry,
            path: params.newPath,
            name: getWorkspacePathFileName(params.newPath) || selected.entry.name,
          };
          selectionStore.selectFsEntry(nextEntry, selected.instanceId, selected.isExternal);
        }
      }
    }
  }

  function remapMovedDirectoryPath(path: string | undefined, oldPath: string, newPath: string) {
    if (!path) return null;
    if (path === oldPath) return newPath;
    if (!path.startsWith(`${oldPath}/`)) return null;
    return `${newPath}${path.slice(oldPath.length)}`;
  }

  function remapMovedEntry(entry: FsEntry, oldPath: string, newPath: string): FsEntry | null {
    const nextPath = remapMovedDirectoryPath(entry.path, oldPath, newPath);
    if (!nextPath) return null;
    return {
      ...entry,
      path: nextPath,
      parentPath: getWorkspacePathParent(nextPath) || undefined,
      name: getWorkspacePathFileName(nextPath) || entry.name,
    };
  }

  function updateSelectionForDirectoryMove(params: { oldPath: string; newPath: string }) {
    const selectedUiEntry = uiStore.selectedFsEntry;
    if (selectedUiEntry?.path) {
      const nextPath = remapMovedDirectoryPath(
        selectedUiEntry.path,
        params.oldPath,
        params.newPath,
      );
      if (nextPath) {
        uiStore.selectedFsEntry = {
          ...selectedUiEntry,
          path: nextPath,
          parentPath: getWorkspacePathParent(nextPath) || undefined,
          name: getWorkspacePathFileName(nextPath) || selectedUiEntry.name,
        };
      }
    }

    const selected = selectionStore.selectedEntity;
    if (!selected || selected.source !== 'fileManager') return;

    if (selected.kind === 'multiple') {
      const nextEntries = selected.entries.map(
        (entry) => remapMovedEntry(entry, params.oldPath, params.newPath) ?? entry,
      );
      selectionStore.selectedEntity = {
        ...selected,
        entries: nextEntries,
      };
      return;
    }

    const nextEntry = remapMovedEntry(selected.entry, params.oldPath, params.newPath);
    if (!nextEntry) return;
    selectionStore.selectedEntity = {
      ...selected,
      path: nextEntry.path,
      name: nextEntry.name,
      entry: nextEntry,
    };
  }

  async function syncTimelinePathsOnMove({
    oldPath,
    newPath,
  }: {
    oldPath: string;
    newPath: string;
  }) {
    const isTimelineFile = oldPath.toLowerCase().endsWith('.otio');

    function matchesOldPath(path: string | null | undefined): boolean {
      if (!path) return false;
      if (isTimelineFile) return path === oldPath;
      return path === oldPath || path.startsWith(`${oldPath}/`);
    }

    function remapPath(path: string): string {
      if (isTimelineFile) return newPath;
      if (path === oldPath) return newPath;
      return `${newPath}${path.slice(oldPath.length)}`;
    }

    const { useProjectTabsStore } = await import('~/stores/project-tabs.store');
    const projectTabsStore = useProjectTabsStore();

    // 1. Update current timeline
    if (matchesOldPath(projectStore.currentTimelinePath)) {
      const nextPath = remapPath(projectStore.currentTimelinePath!);
      projectStore.currentTimelinePath = nextPath;
      projectStore.currentFileName = nextPath.split('/').pop() ?? nextPath;
    }

    // 2. Update open paths
    const timelines = projectStore.projectSettings.timelines;
    const openPaths = timelines.openPaths;
    let openPathsChanged = false;
    for (let i = 0; i < openPaths.length; i++) {
      const path = openPaths[i];
      if (path && matchesOldPath(path)) {
        openPaths[i] = remapPath(path);
        openPathsChanged = true;
      }
    }
    if (openPathsChanged) {
      timelines.openPaths = [...openPaths];
    }

    // 3. Update sessions
    const sessions = timelines?.sessions ?? {};
    const newSessions: Record<string, import('~/utils/project-settings').TimelineSessionState> = {};
    let sessionsChanged = false;
    for (const [path, session] of Object.entries(sessions)) {
      if (matchesOldPath(path)) {
        newSessions[remapPath(path)] = session;
        sessionsChanged = true;
      } else {
        newSessions[path] = session;
      }
    }
    if (sessionsChanged && timelines) {
      timelines.sessions = newSessions;
    }

    // 4. Update focus store
    if (matchesOldPath(focusStore.activeTimelinePath)) {
      focusStore.setActiveTimelinePath(remapPath(focusStore.activeTimelinePath!));
    }

    // 5. Update mainFocusByTimeline
    const mainFocusByTimeline = ((focusStore as unknown as Record<string, unknown>)
      .mainFocusByTimeline ?? {}) as Record<string, MainPanelFocus>;
    const newFocusByTimeline: Record<string, MainPanelFocus> = {};
    let focusChanged = false;
    for (const [path, focus] of Object.entries(mainFocusByTimeline)) {
      if (matchesOldPath(path)) {
        newFocusByTimeline[remapPath(path)] = focus as MainPanelFocus;
        focusChanged = true;
      } else {
        newFocusByTimeline[path] = focus as MainPanelFocus;
      }
    }
    if (focusChanged) {
      (focusStore as unknown as Record<string, unknown>).mainFocusByTimeline =
        newFocusByTimeline as Record<string, MainPanelFocus>;
    }

    // 6. Update file tabs
    const fileTabs = projectTabsStore.fileTabs;
    let tabsChanged = false;
    for (const tab of fileTabs) {
      if (matchesOldPath(tab.filePath)) {
        tab.filePath = remapPath(tab.filePath);
        tabsChanged = true;
      }
    }
    if (tabsChanged) {
      projectTabsStore.fileTabs = [...fileTabs];
    }
  }

  return {
    updateSelectionPath,
    updateSelectionForDirectoryMove,
    syncTimelinePathsOnMove,
  };
}
