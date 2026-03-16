import { ref } from 'vue';

export function useExportState() {
  const isExporting = ref(false);
  const exportProgress = ref(0);
  const exportError = ref<string | null>(null);
  const exportPhase = ref<'preparing' | 'encoding' | 'saving' | null>(null);
  const exportWarnings = ref<string[]>([]);

  const cancelRequested = ref(false);
  const activeExportTaskId = ref<string | null>(null);

  function resetExportState() {
    isExporting.value = false;
    exportProgress.value = 0;
    exportError.value = null;
    exportPhase.value = null;
    exportWarnings.value = [];
    cancelRequested.value = false;
    activeExportTaskId.value = null;
  }

  return {
    isExporting,
    exportProgress,
    exportError,
    exportPhase,
    exportWarnings,
    cancelRequested,
    activeExportTaskId,
    resetExportState,
  };
}
