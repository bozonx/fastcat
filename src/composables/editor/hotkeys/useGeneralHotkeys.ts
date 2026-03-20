import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useFilesPageStore } from '~/stores/files-page.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import type { createHotkeyHoldRunner } from '~/utils/hotkeys/holdRunner';
import { DEFAULT_TIMELINE_ZOOM_POSITION, stepTimelineZoomPosition } from '~/utils/zoom';

export function useGeneralHotkeys(
  zoomHoldRunner: ReturnType<typeof createHotkeyHoldRunner>,
  volumeHoldRunner: ReturnType<typeof createHotkeyHoldRunner>,
) {
  const timelineStore = useTimelineStore();
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const selectionStore = useSelectionStore();
  const projectStore = useProjectStore();
  const filesPageStore = useFilesPageStore();
  const { clipboardPayload, setClipboardPayload } = useAppClipboard();
  const { loadTimeline } = useProjectActions();

  let fileManager: ReturnType<typeof useFileManager> | null = null;

  function getFileManager() {
    fileManager ??= useFileManager();
    return fileManager;
  }

  function isFileManagerFocus() {
    return focusStore.effectiveFocus === 'filesBrowser' || focusStore.effectiveFocus === 'left';
  }

  function getSelectedFsEntries() {
    const selected = selectionStore.selectedEntity;
    if (selected?.source !== 'fileManager') return [];
    if (selected.kind === 'multiple') return selected.entries;
    return [selected.entry];
  }

  function getFileManagerPasteTargetDirPath() {
    if (focusStore.effectiveFocus === 'filesBrowser') {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager' && selected.kind === 'directory') {
        return selected.entry.path ?? '';
      }
      return filesPageStore.selectedFolder?.path ?? '';
    }

    const selected = selectionStore.selectedEntity;
    if (selected?.source === 'fileManager' && selected.kind === 'directory') {
      return selected.entry.path ?? '';
    }

    return '';
  }

  async function handleFileManagerPaste() {
    const payload = clipboardPayload;
    if (!payload || payload.source !== 'fileManager' || payload.items.length === 0) {
      return false;
    }

    const targetDirPath = getFileManagerPasteTargetDirPath();
    const fileManager = getFileManager();

    for (const item of payload.items) {
      const source = fileManager.findEntryByPath(item.path);
      if (!source) continue;

      if (payload.operation === 'copy') {
        await fileManager.copyEntry({
          source,
          targetDirPath,
        });
      } else {
        await fileManager.moveEntry({
          source,
          targetDirPath,
        });
      }
    }

    if (payload.operation === 'cut') {
      setClipboardPayload(null);
    }

    uiStore.notifyFileManagerUpdate();
    return true;
  }

  function createMarkerAtPlayhead() {
    const existing = timelineStore.getMarkers();
    timelineStore.addMarkerAtPlayhead();
    const next = timelineStore.getMarkers();
    const created = next.find((m) => !existing.some((x) => x.id === m.id)) ?? next[next.length - 1];
    if (created) {
      selectionStore.selectTimelineMarker(created.id);
    }
  }

  function startVolumeHotkeyHold(params: { step: number; keyCode: string }) {
    volumeHoldRunner.startHold({
      keyCode: params.keyCode,
      action: () => {
        timelineStore.setAudioVolume(timelineStore.audioVolume + params.step);
      },
    });
  }

  function startZoomHotkeyHold(params: { direction: 1 | -1; keyCode: string }) {
    zoomHoldRunner.startHold({
      keyCode: params.keyCode,
      action: () => {
        if (focusStore.effectiveFocus === 'timeline') {
          timelineStore.setTimelineZoom(
            stepTimelineZoomPosition(timelineStore.timelineZoom, params.direction),
          );
        } else if (isPreviewFocus()) {
          uiStore.triggerPreviewZoom(params.direction);
        } else if (focusStore.effectiveFocus === 'monitor') {
          uiStore.triggerMonitorZoom(params.direction);
        }
      },
    });
  }

  function isPreviewFocus() {
    return focusStore.canUsePreviewHotkeys;
  }

  function toggleTimelineSelectAll() {
    const trackId = timelineStore.getSelectedOrActiveTrackId();
    if (trackId) {
      const track = timelineStore.timelineDoc?.tracks.find((item) => item.id === trackId);
      const trackClipIds =
        track?.items.filter((item) => item.kind === 'clip').map((item) => item.id) ?? [];
      const selectedIds = timelineStore.selectedItemIds;
      const isAllSelected =
        trackClipIds.length > 0 &&
        selectedIds.length === trackClipIds.length &&
        trackClipIds.every((id) => selectedIds.includes(id));

      if (isAllSelected) {
        timelineStore.clearSelection();
        timelineStore.selectTrack(null);
        return;
      }

      timelineStore.selectAllClipsOnTrack(trackId);
      return;
    }

    const allClipIds =
      timelineStore.timelineDoc?.tracks.flatMap((track) =>
        track.items.filter((item) => item.kind === 'clip').map((item) => item.id),
      ) ?? [];
    const selectedIds = timelineStore.selectedItemIds;
    const isAllSelected =
      allClipIds.length > 0 &&
      selectedIds.length === allClipIds.length &&
      allClipIds.every((id) => selectedIds.includes(id));

    if (isAllSelected) {
      timelineStore.clearSelection();
      timelineStore.selectTrack(null);
      return;
    }

    timelineStore.selectAllClips();
  }

  const handlers: Partial<Record<HotkeyCommandId, (e: KeyboardEvent) => boolean>> = {
    'general.focus': () => {
      focusStore.handleFocusHotkey();
      return true;
    },

    'general.undo': () => {
      timelineStore.undoTimeline();
      return true;
    },

    'general.redo': () => {
      timelineStore.redoTimeline();
      return true;
    },

    'general.rename': () => {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager') {
        if (selected.kind === 'file' || selected.kind === 'directory') {
          uiStore.pendingFsEntryRename = selected.entry;
          return true;
        } else if (selected.kind === 'multiple' && selected.entries.length === 1) {
          const [entry] = selected.entries;
          if (entry) {
            uiStore.pendingFsEntryRename = entry;
            return true;
          }
        }
      }
      return false;
    },

    'general.copy': () => {
      if (!isFileManagerFocus()) return false;

      const entries = getSelectedFsEntries();
      if (entries.length === 0) return false;

      setClipboardPayload({
        source: 'fileManager',
        operation: 'copy',
        items: entries
          .filter((entry) => Boolean(entry.path))
          .map((entry) => ({
            path: entry.path!,
            kind: entry.kind,
            name: entry.name,
          })),
      });

      return true;
    },

    'general.cut': () => {
      if (!isFileManagerFocus()) return false;

      const entries = getSelectedFsEntries();
      if (entries.length === 0) return false;

      setClipboardPayload({
        source: 'fileManager',
        operation: 'cut',
        items: entries
          .filter((entry) => Boolean(entry.path))
          .map((entry) => ({
            path: entry.path!,
            kind: entry.kind,
            name: entry.name,
          })),
      });

      return true;
    },

    'general.paste': () => {
      if (!isFileManagerFocus()) return false;
      void handleFileManagerPaste();
      return true;
    },

    'general.delete': () => {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager') {
        if (selected.kind === 'multiple') {
          uiStore.pendingFsEntryDelete = selected.entries;
        } else {
          uiStore.pendingFsEntryDelete = [selected.entry];
        }
      } else if (timelineStore.getSelectionRange()) {
        timelineStore.removeSelectionRange();
      } else if (selected?.source === 'timeline') {
        if (selected.kind === 'track') {
          timelineStore.deleteTrack(selected.trackId, { allowNonEmpty: true });
          selectionStore.clearSelection();
        } else if (selected.kind === 'marker') {
          timelineStore.removeMarker(selected.markerId);
          selectionStore.clearSelection();
        } else {
          timelineStore.deleteFirstSelectedItem();
        }
      } else if (timelineStore.selectedItemIds.length > 0) {
        timelineStore.deleteFirstSelectedItem();
      }
      return true;
    },

    'general.deselect': () => {
      selectionStore.clearSelection();
      timelineStore.clearSelection();
      timelineStore.selectTrack(null);
      return true;
    },

    'general.mute': () => {
      timelineStore.toggleAudioMuted();
      return true;
    },

    'general.addMarker': () => {
      createMarkerAtPlayhead();
      return true;
    },

    'general.volumeUp': (e) => {
      startVolumeHotkeyHold({ step: 0.05, keyCode: e.code });
      return true;
    },

    'general.volumeDown': (e) => {
      startVolumeHotkeyHold({ step: -0.05, keyCode: e.code });
      return true;
    },

    'general.zoomIn': (e) => {
      startZoomHotkeyHold({ direction: 1, keyCode: e.code });
      return true;
    },

    'general.zoomOut': (e) => {
      startZoomHotkeyHold({ direction: -1, keyCode: e.code });
      return true;
    },

    'general.zoomReset': () => {
      if (focusStore.effectiveFocus === 'timeline') {
        timelineStore.setTimelineZoom(DEFAULT_TIMELINE_ZOOM_POSITION);
      } else if (isPreviewFocus()) {
        uiStore.triggerPreviewZoomReset();
      } else if (focusStore.effectiveFocus === 'monitor') {
        uiStore.triggerMonitorZoomReset();
      }
      return true;
    },
    'general.switchViewFiles': () => {
      projectStore.setView('files');
      return true;
    },
    'general.switchViewCut': () => {
      projectStore.setView('cut');
      return true;
    },
    'general.switchViewSound': () => {
      projectStore.setView('sound');
      return true;
    },
    'general.switchViewExport': () => {
      projectStore.setView('export');
      return true;
    },
    'general.selectAll': () => {
      if (focusStore.effectiveFocus === 'timeline') {
        toggleTimelineSelectAll();
        return true;
      }
      if (focusStore.effectiveFocus === 'filesBrowser') {
        uiStore.fileBrowserSelectAllTrigger++;
        return true;
      }
      if (focusStore.effectiveFocus === 'project' || focusStore.effectiveFocus === 'left') {
        uiStore.fileTreeSelectAllTrigger++;
        return true;
      }
      return false;
    },
  };

  function handleFullscreen() {
    if (projectStore.currentView === 'fullscreen') {
      projectStore.setView(projectStore.lastViewBeforeFullscreen ?? 'cut');
      return true;
    }

    // Toggle file preview fullscreen (modal for text, true fullscreen for media)
    // ONLY if focus is on the Properties panel
    if (focusStore.isPropertiesFocus) {
      const entity = selectionStore.selectedEntity;
      if (entity?.source === 'fileManager' && entity.kind === 'file') {
        uiStore.togglePreviewFullscreen();
        return true;
      }
    }

    projectStore.goToFullscreen();
    return true;
  }

  handlers['general.fullscreen'] = () => {
    return handleFullscreen();
  };

  // Timeline tabs
  for (let i = 1; i <= 9; i++) {
    const tabId = `general.tab${i}` as HotkeyCommandId;
    handlers[tabId] = () => {
      const openPaths = projectStore.projectSettings.timelines.openPaths;
      if (i > 0 && i <= openPaths.length) {
        const path = openPaths[i - 1];
        if (path) {
          void loadTimeline(path);
        }
      }
      return true;
    };
  }

  return handlers;
}
