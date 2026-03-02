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
  type: 'fileManager' | 'monitor' | 'properties' | 'text';
  title?: string;
  // If type is text, store file details
  filePath?: string;
  fileContent?: string;
}

const viewConfigs: Record<EditorView, ViewConfig> = {
  files: { timelineHeight: 30 },
  cut: { timelineHeight: 40 },
  sound: { timelineHeight: 60 },
  fullscreen: { timelineHeight: 0 },
};

export function createEditorViewModule(projectIdRef: Ref<string | null>) {
  const currentView = ref<EditorView>('cut');

  // Dynamic panels for cut view
  const defaultCutPanels: DynamicPanel[] = [
    { id: 'fileManager', type: 'fileManager' },
    { id: 'monitor', type: 'monitor' },
    { id: 'properties', type: 'properties' },
  ];

  const cutPanelsKey = computed(() => `gran-cut-panels-${projectIdRef.value ?? 'no-project'}`);
  const cutPanels = ref<DynamicPanel[]>([...defaultCutPanels]);

  // Load panels from local storage
  watch(
    () => cutPanelsKey.value,
    (key) => {
      const stored = readLocalStorageJson<DynamicPanel[] | null>(key, null);
      if (stored && Array.isArray(stored) && stored.length > 0) {
        cutPanels.value = stored;
      } else {
        cutPanels.value = [...defaultCutPanels];
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

    // Insert in the middle
    const middleIndex = Math.floor(cutPanels.value.length / 2);
    cutPanels.value.splice(middleIndex, 0, newPanel);
  }

  function removePanel(id: string) {
    cutPanels.value = cutPanels.value.filter((p) => p.id !== id);
  }

  function movePanel(fromIndex: number, toIndex: number) {
    if (
      fromIndex < 0 ||
      fromIndex >= cutPanels.value.length ||
      toIndex < 0 ||
      toIndex > cutPanels.value.length ||
      fromIndex === toIndex
    )
      return;

    const panels = [...cutPanels.value];
    const [movedPanel] = panels.splice(fromIndex, 1);
    if (movedPanel) {
      panels.splice(toIndex, 0, movedPanel);
      cutPanels.value = panels;
    }
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
