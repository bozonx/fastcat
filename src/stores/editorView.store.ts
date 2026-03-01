import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

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

export const useEditorViewStore = defineStore('editorView', () => {
  const currentView = ref<EditorView>('cut');

  const timelineHeight = computed(() => viewConfigs[currentView.value].timelineHeight);

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
});
