import { defineStore } from 'pinia';
import { ref } from 'vue';

export type EditorView = 'files' | 'cut' | 'sound' | 'fullscreen';

export const useEditorViewStore = defineStore('editorView', () => {
  const currentView = ref<EditorView>('cut');

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
    setView,
    goToFiles,
    goToCut,
    goToSound,
    goToFullscreen,
  };
});
