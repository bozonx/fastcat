import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { readLocalStorageJson, writeLocalStorageJson } from './ui/uiLocalStorage';
import { getPanelSizesKey } from '~/composables/ui/usePersistedSplitpanes';
import type { Ref } from 'vue';

export type EditorView = 'files' | 'cut' | 'sound' | 'fullscreen';

export interface ViewConfig {
  timelineHeight: number;
}

export interface DynamicPanel {
  id: string;
  type: 'fileManager' | 'monitor' | 'properties' | 'text' | 'media';
  title?: string;
  // If type is text or media, store file details
  filePath?: string;
  fileContent?: string;
  mediaType?: 'video' | 'audio' | 'image' | 'unknown' | null;
  fsEntry?: any; // To pass to EntryPreviewBox or logic
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

  function addTextPanel(filePath: string, fileContent: string, title: string) {
    const newPanel: DynamicPanel = {
      id: `text-${Date.now()}`,
      type: 'text',
      filePath,
      fileContent,
      title,
    };

    const middleIndex = Math.floor(cutPanels.value.length / 2);
    cutPanels.value.splice(middleIndex, 0, { id: `col-${generateId()}`, panels: [newPanel] });
  }

  function addMediaPanel(
    fsEntry: any,
    mediaType: 'video' | 'audio' | 'image' | 'unknown' | null,
    title: string,
  ) {
    const newPanel: DynamicPanel = {
      id: `media-${Date.now()}`,
      type: 'media',
      filePath: fsEntry.path ?? fsEntry.name,
      mediaType,
      title,
    };

    const middleIndex = Math.floor(cutPanels.value.length / 2);
    cutPanels.value.splice(middleIndex, 0, { id: `col-${generateId()}`, panels: [newPanel] });
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

  function movePanel(
    fromCol: number,
    fromRow: number,
    toCol: number,
    toRow: number,
    position: PanelPosition,
  ) {
    const panels = cutPanels.value.map((col) => ({ id: col.id, panels: [...col.panels] }));

    // Bounds check
    if (!panels[fromCol] || !panels[fromCol]!.panels[fromRow]) return;

    // Check if moving to exact same spot without split changes
    if (fromCol === toCol && fromRow === toRow && (position === 'top' || position === 'bottom'))
      return;

    // Remove the panel from its original position
    const [movedPanel] = panels[fromCol]!.panels.splice(fromRow, 1);
    if (!movedPanel) return;

    // Adjust target indices if we removed an item from the same column before the target row
    let adjustedToCol = toCol;
    let adjustedToRow = toRow;
    if (fromCol === toCol && fromRow < toRow) {
      adjustedToRow -= 1;
    }

    // Insert the panel at the new position
    if (position === 'left') {
      panels.splice(adjustedToCol, 0, { id: `col-${generateId()}`, panels: [movedPanel] });
    } else if (position === 'right') {
      panels.splice(adjustedToCol + 1, 0, { id: `col-${generateId()}`, panels: [movedPanel] });
    } else if (position === 'top') {
      if (!panels[adjustedToCol]) panels[adjustedToCol] = { id: `col-${generateId()}`, panels: [] };
      panels[adjustedToCol]!.panels.splice(adjustedToRow, 0, movedPanel);
    } else if (position === 'bottom') {
      if (!panels[adjustedToCol]) panels[adjustedToCol] = { id: `col-${generateId()}`, panels: [] };
      panels[adjustedToCol]!.panels.splice(adjustedToRow + 1, 0, movedPanel);
    }

    // Clean up empty columns and update
    cutPanels.value = panels.filter((col) => col && col.panels.length > 0);
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

  function goToFullscreen() {
    currentView.value = 'fullscreen';
  }

  return {
    currentView,
    timelineHeight,
    cutPanels,
    addTextPanel,
    addMediaPanel,
    removePanel,
    movePanel,
    setView,
    goToFiles,
    goToCut,
    goToSound,
    goToFullscreen,
  };
}

export const useEditorViewStore = defineStore('editorView', () => {
  return createEditorViewModule(ref(null));
});
