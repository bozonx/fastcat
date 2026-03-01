import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { readLocalStorageJson, writeLocalStorageJson } from './ui/uiLocalStorage';
import { getPanelSizesKey } from '~/composables/ui/usePersistedSplitpanes';
import type { Ref } from 'vue';

export type EditorView = 'files' | 'cut' | 'sound' | 'fullscreen';

export interface ViewConfig {
  timelineHeight: number;
}

const viewConfigs: Record<EditorView, ViewConfig> = {
  files: { timelineHeight: 30 },
  cut: { timelineHeight: 40 },
  sound: { timelineHeight: 60 },
  fullscreen: { timelineHeight: 0 },
};

export function createEditorViewModule(projectIdRef: Ref<string | null>) {
  const currentView = ref<EditorView>('cut');

  const timelineHeightKey = computed(() => getPanelSizesKey('timeline-height', projectIdRef.value));

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
