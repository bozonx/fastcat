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

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom';

const viewConfigs: Record<EditorView, ViewConfig> = {
  files: { timelineHeight: 30 },
  cut: { timelineHeight: 40 },
  sound: { timelineHeight: 60 },
  fullscreen: { timelineHeight: 0 },
};

export function createEditorViewModule(projectIdRef: Ref<string | null>) {
  const currentView = ref<EditorView>('cut');

  // Dynamic panels for cut view, now 2D array: columns -> rows
  const defaultCutPanels: DynamicPanel[][] = [
    [{ id: 'fileManager', type: 'fileManager' }],
    [{ id: 'monitor', type: 'monitor' }],
    [{ id: 'properties', type: 'properties' }],
  ];

  const cutPanelsKey = computed(() => `gran-cut-panels-${projectIdRef.value ?? 'no-project'}`);
  const cutPanels = ref<DynamicPanel[][]>([...defaultCutPanels.map((col) => [...col])]);

  // Load panels from local storage
  watch(
    () => cutPanelsKey.value,
    (key) => {
      const stored = readLocalStorageJson<any[] | null>(key, null);
      if (stored && Array.isArray(stored) && stored.length > 0) {
        // Migration from 1D to 2D
        if (!Array.isArray(stored[0])) {
          cutPanels.value = stored.map((p) => [p]);
        } else {
          cutPanels.value = stored;
        }
      } else {
        cutPanels.value = [...defaultCutPanels.map((col) => [...col])];
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

    // Insert as a new column in the middle
    const middleIndex = Math.floor(cutPanels.value.length / 2);
    cutPanels.value.splice(middleIndex, 0, [newPanel]);
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

    // Insert as a new column in the middle
    const middleIndex = Math.floor(cutPanels.value.length / 2);
    cutPanels.value.splice(middleIndex, 0, [newPanel]);
  }

  function removePanel(id: string) {
    const newPanels: DynamicPanel[][] = [];
    for (const col of cutPanels.value) {
      const newCol = col.filter((p) => p.id !== id);
      if (newCol.length > 0) {
        newPanels.push(newCol);
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
    const panels = cutPanels.value.map((col) => [...col]);

    // Bounds check
    if (!panels[fromCol] || !panels[fromCol]![fromRow]) return;

    // Remove the panel from its original position
    const [movedPanel] = panels[fromCol]!.splice(fromRow, 1);
    if (!movedPanel) return;

    // Adjust target indices if we removed an item from the same column before the target row
    let adjustedToCol = toCol;
    let adjustedToRow = toRow;
    if (fromCol === toCol && fromRow < toRow) {
      adjustedToRow -= 1;
    }

    // Insert the panel at the new position
    if (position === 'left') {
      panels.splice(adjustedToCol, 0, [movedPanel]);
    } else if (position === 'right') {
      panels.splice(adjustedToCol + 1, 0, [movedPanel]);
    } else if (position === 'top') {
      if (!panels[adjustedToCol]) panels[adjustedToCol] = [];
      panels[adjustedToCol]!.splice(adjustedToRow, 0, movedPanel);
    } else if (position === 'bottom') {
      if (!panels[adjustedToCol]) panels[adjustedToCol] = [];
      panels[adjustedToCol]!.splice(adjustedToRow + 1, 0, movedPanel);
    }

    // Clean up empty columns
    cutPanels.value = panels.filter((col) => col && col.length > 0);
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
