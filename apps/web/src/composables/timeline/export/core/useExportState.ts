import { storeToRefs } from 'pinia';
import { useExportStore } from '~/stores/export.store';

export function useExportState() {
  const store = useExportStore();
  const {
    isExporting,
    exportProgress,
    exportError,
    exportPhase,
    exportWarnings,
    exportDurationMs,
    lastExportStatus,
    cancelRequested,
    activeExportTaskId,
  } = storeToRefs(store);

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
    resetExportState: store.resetExportProcessState,
  };
}
