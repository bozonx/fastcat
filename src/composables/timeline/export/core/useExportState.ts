import { ref } from 'vue';

export function useExportState() {
  const isExporting = ref(false);
  const exportProgress = ref(0);
  const exportError = ref<string | null>(null);
  const exportPhase = ref<'preparing' | 'encoding' | 'saving' | null>(null);
  const exportWarnings = ref<string[]>([]);
  const exportDurationMs = ref<number | null>(null);
  const lastExportStatus = ref<'success' | 'error' | null>(null);

  const cancelRequested = ref(false);
  const activeExportTaskId = ref<string | null>(null);

  function resetExportState() {
    exportProgress.value = 0;
    exportError.value = null;
    exportPhase.value = null;
    exportWarnings.value = [];
    exportDurationMs.value = null;
    lastExportStatus.value = null;
    cancelRequested.value = false;
    if (!isExporting.value) {
      activeExportTaskId.value = null;
    }
  }

  return {
    isExporting,
    exportProgress,
    exportError,
    exportPhase,
    exportWarnings,
    exportDurationMs,
    lastExportStatus,
    cancelRequested,
    activeExportTaskId,
    resetExportState,
  };
}
