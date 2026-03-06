import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
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
  const { loadTimeline } = useProjectActions();

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
        timelineStore.setTimelineZoom(
          stepTimelineZoomPosition(timelineStore.timelineZoom, params.direction),
        );
      },
    });
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
          (uiStore as any).pendingFsEntryRename = selected.entry;
          return true;
        } else if (selected.kind === 'multiple' && selected.entries.length === 1) {
          (uiStore as any).pendingFsEntryRename = selected.entries[0];
          return true;
        }
      }
      return false;
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
      if (focusStore.effectiveFocus === 'timeline') {
        startZoomHotkeyHold({ direction: 1, keyCode: e.code });
      } else if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
        uiStore.triggerPreviewZoom(1);
      } else if (focusStore.effectiveFocus === 'monitor') {
        uiStore.triggerMonitorZoom(1);
      }
      return true;
    },

    'general.zoomOut': (e) => {
      if (focusStore.effectiveFocus === 'timeline') {
        startZoomHotkeyHold({ direction: -1, keyCode: e.code });
      } else if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
        uiStore.triggerPreviewZoom(-1);
      } else if (focusStore.effectiveFocus === 'monitor') {
        uiStore.triggerMonitorZoom(-1);
      }
      return true;
    },

    'general.zoomReset': () => {
      if (focusStore.effectiveFocus === 'timeline') {
        timelineStore.setTimelineZoom(DEFAULT_TIMELINE_ZOOM_POSITION);
      } else if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
        uiStore.triggerPreviewZoomReset();
      } else if (focusStore.effectiveFocus === 'monitor') {
        uiStore.triggerMonitorZoomReset();
      }
      return true;
    },
    'general.switchViewFiles': () => {
      void import('~/stores/project.store').then((m) => m.useProjectStore().setView('files'));
      return true;
    },
    'general.switchViewCut': () => {
      void import('~/stores/project.store').then((m) => m.useProjectStore().setView('cut'));
      return true;
    },
    'general.switchViewSound': () => {
      void import('~/stores/project.store').then((m) => m.useProjectStore().setView('sound'));
      return true;
    },
    'general.switchViewExport': () => {
      void import('~/stores/project.store').then((m) => m.useProjectStore().setView('export'));
      return true;
    },
  };

  async function handleFullscreen() {
    const { useEditorViewStore } = await import('~/stores/editorView.store');
    const viewStore = useEditorViewStore();

    if (viewStore.currentView === 'fullscreen') {
      viewStore.goToCut();
      return true;
    }

    if (focusStore.effectiveFocus === 'right' || focusStore.effectiveFocus === 'left') {
      const entity = selectionStore.selectedEntity;
      if (entity?.source === 'fileManager' && entity.kind === 'file') {
        uiStore.togglePreviewFullscreen();
        return true;
      }
    }

    viewStore.goToFullscreen();
    return true;
  }

  handlers['general.fullscreen'] = () => {
    void handleFullscreen();
    return true;
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
