import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { readLocalStorageJson, writeLocalStorageJson } from './ui/uiLocalStorage';
import { getPanelSizesKey } from '~/composables/ui/usePersistedSplitpanes';
import type { FsEntry } from '~/types/fs';
import type { Ref } from 'vue';

export type EditorView = 'files' | 'cut' | 'sound' | 'export' | 'fullscreen';

export interface ViewConfig {
  timelineHeight: number;
}

export interface DynamicPanel {
  id: string;
  type: 'fileManager' | 'monitor' | 'properties' | 'text' | 'media' | 'history' | 'effects';
  title?: string;
  // If type is text or media, store file details
  filePath?: string;
  fileContent?: string;
  mediaType?: 'video' | 'audio' | 'image' | 'unknown' | null;
  fsEntry?: FsEntry; // To pass to EntryPreviewBox or logic
}

export interface PanelColumn {
  id: string;
  panels: DynamicPanel[];
}

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';

const viewConfigs: Record<EditorView, ViewConfig> = {
  files: { timelineHeight: 30 },
  cut: { timelineHeight: 40 },
  sound: { timelineHeight: 60 },
  export: { timelineHeight: 30 },
  fullscreen: { timelineHeight: 0 },
};

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function createEditorViewModule(projectIdRef: Ref<string | null>) {
  const currentView = ref<EditorView>('cut');

  // Dynamic panels for cut view, 2D structure
  const defaultCutPanels: PanelColumn[] = [
    { id: 'col-1', panels: [{ id: 'fileManager', type: 'fileManager' }] },
    { id: 'col-2', panels: [{ id: 'monitor', type: 'monitor' }] },
    { id: 'col-3', panels: [{ id: 'properties', type: 'properties' }] },
  ];

  const cutPanelsKey = computed(() => `gran-cut-panels-${projectIdRef.value ?? 'no-project'}`);
  const cutPanels = ref<PanelColumn[]>([
    ...defaultCutPanels.map((col) => ({ id: col.id, panels: [...col.panels] })),
  ]);

  // Load panels from local storage
  watch(
    () => cutPanelsKey.value,
    (key) => {
      const stored = readLocalStorageJson<any[] | null>(key, null);
      if (stored && Array.isArray(stored) && stored.length > 0) {
        // Migration from 1D to 2D columns
        if (!Array.isArray(stored[0]) && !stored[0].panels) {
          // 1D array of panels
          cutPanels.value = stored.map((p) => ({ id: `col-${generateId()}`, panels: [p] }));
        } else if (Array.isArray(stored[0])) {
          // 2D array without column IDs
          cutPanels.value = stored.map((col) => ({ id: `col-${generateId()}`, panels: col }));
        } else {
          // Already PanelColumn format
          cutPanels.value = stored;
        }
      } else {
        cutPanels.value = [
          ...defaultCutPanels.map((col) => ({ id: col.id, panels: [...col.panels] })),
        ];
      }
    },
    { immediate: true },
  );

  // Save panels to local storage
  watch(
    cutPanels,
    (panels) => {
      writeLocalStorageJson(cutPanelsKey.value, panels);
    },
    { deep: true },
  );

  function insertPanelAt(newPanel: DynamicPanel, targetPanelId?: string, position?: PanelPosition) {
    if (!targetPanelId || !position) {
      const middleIndex = Math.floor(cutPanels.value.length / 2);
      cutPanels.value.splice(middleIndex, 0, { id: `col-${generateId()}`, panels: [newPanel] });
      return;
    }

    const cols = cutPanels.value.map((col) => ({ id: col.id, panels: [...col.panels] }));

    let toColIdx = -1;
    let toRowIdx = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      const ri = cols[ci]!.panels.findIndex((p) => p.id === targetPanelId);
      if (ri !== -1) {
        toColIdx = ci;
        toRowIdx = ri;
        break;
      }
    }

    if (toColIdx === -1) {
      cols.push({ id: `col-${generateId()}`, panels: [newPanel] });
    } else {
      if (position === 'left') {
        cols.splice(toColIdx, 0, { id: `col-${generateId()}`, panels: [newPanel] });
      } else if (position === 'right') {
        cols.splice(toColIdx + 1, 0, { id: `col-${generateId()}`, panels: [newPanel] });
      } else if (position === 'top') {
        cols[toColIdx]!.panels.splice(toRowIdx, 0, newPanel);
      } else if (position === 'bottom') {
        cols[toColIdx]!.panels.splice(toRowIdx + 1, 0, newPanel);
      }
    }

    cutPanels.value = cols;
  }

  function addTextPanel(
    filePath: string,
    fileContent: string,
    title: string,
    targetPanelId?: string,
    position?: PanelPosition,
  ) {
    const newPanel: DynamicPanel = {
      id: `text-${Date.now()}`,
      type: 'text',
      filePath,
      fileContent,
      title,
    };
    insertPanelAt(newPanel, targetPanelId, position);
  }

  function addMediaPanel(
    fsEntry: FsEntry,
    mediaType: 'video' | 'audio' | 'image' | 'unknown' | null,
    title: string,
    targetPanelId?: string,
    position?: PanelPosition,
  ) {
    const newPanel: DynamicPanel = {
      id: `media-${Date.now()}`,
      type: 'media',
      filePath: fsEntry.path ?? fsEntry.name,
      mediaType,
      title,
    };
    insertPanelAt(newPanel, targetPanelId, position);
  }

  function removePanel(id: string) {
    const newPanels: PanelColumn[] = [];
    for (const col of cutPanels.value) {
      const newColPanels = col.panels.filter((p) => p.id !== id);
      if (newColPanels.length > 0) {
        newPanels.push({ id: col.id, panels: newColPanels });
      }
    }
    cutPanels.value = newPanels;
  }

  function movePanel(panelId: string, targetPanelId: string, position: PanelPosition) {
    if (panelId === targetPanelId) return;

    const cols = cutPanels.value.map((col) => ({ id: col.id, panels: [...col.panels] }));

    // Find source
    let fromColIdx = -1;
    let fromRowIdx = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      const ri = cols[ci]!.panels.findIndex((p) => p.id === panelId);
      if (ri !== -1) {
        fromColIdx = ci;
        fromRowIdx = ri;
        break;
      }
    }
    if (fromColIdx === -1) return;

    // Find target
    let toColIdx = -1;
    let toRowIdx = -1;
    for (let ci = 0; ci < cols.length; ci++) {
      const ri = cols[ci]!.panels.findIndex((p) => p.id === targetPanelId);
      if (ri !== -1) {
        toColIdx = ci;
        toRowIdx = ri;
        break;
      }
    }
    if (toColIdx === -1) return;

    // No-op: same position for row moves
    if (
      fromColIdx === toColIdx &&
      fromRowIdx === toRowIdx &&
      (position === 'top' || position === 'bottom')
    )
      return;

    // Remove source panel
    const [movedPanel] = cols[fromColIdx]!.panels.splice(fromRowIdx, 1);
    if (!movedPanel) return;

    // Re-find target after removal (target may have shifted if same column and source was before target)
    const adjustedToColIdx = toColIdx;
    let adjustedToRowIdx = toRowIdx;
    if (fromColIdx === toColIdx && fromRowIdx < toRowIdx) {
      adjustedToRowIdx -= 1;
    }

    // Insert at new position
    if (position === 'left') {
      cols.splice(adjustedToColIdx, 0, { id: `col-${generateId()}`, panels: [movedPanel] });
    } else if (position === 'right') {
      cols.splice(adjustedToColIdx + 1, 0, { id: `col-${generateId()}`, panels: [movedPanel] });
    } else if (position === 'top') {
      cols[adjustedToColIdx]!.panels.splice(adjustedToRowIdx, 0, movedPanel);
    } else if (position === 'bottom') {
      cols[adjustedToColIdx]!.panels.splice(adjustedToRowIdx + 1, 0, movedPanel);
    }

    cutPanels.value = cols.filter((col) => col.panels.length > 0);
  }

  const timelineHeightKey = computed(() =>
    getPanelSizesKey(`timeline-height-${currentView.value}`, projectIdRef.value),
  );

  const timelineHeight = computed({
    get() {
      const key = timelineHeightKey.value;
      const stored = readLocalStorageJson<number | null>(key, null);
      if (stored && stored > 0 && stored < 100) {
        return stored;
      }
      return viewConfigs[currentView.value].timelineHeight;
    },
    set(value: number) {
      const key = timelineHeightKey.value;
      writeLocalStorageJson(key, value);
    },
  });

  function setView(view: EditorView) {
    currentView.value = view;
  }

  function goToFiles() {
    currentView.value = 'files';
  }

  function goToCut() {
    currentView.value = 'cut';
  }

  function goToSound() {
    currentView.value = 'sound';
  }

  function goToExport() {
    currentView.value = 'export';
  }

  function goToFullscreen() {
    currentView.value = 'fullscreen';
  }

  return {
    currentView,
    timelineHeight,
    cutPanels,
    insertPanelAt,
    addTextPanel,
    addMediaPanel,
    removePanel,
    movePanel,
    setView,
    goToFiles,
    goToCut,
    goToSound,
    goToExport,
    goToFullscreen,
  };
}

export const useEditorViewStore = defineStore('editorView', () => {
  return createEditorViewModule(ref(null));
});
