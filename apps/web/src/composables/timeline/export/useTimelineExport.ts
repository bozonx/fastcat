import { useExportState } from './core/useExportState';
import { useExportConfig } from './core/useExportConfig';
import { useExportFileSystem } from './core/useExportFileSystem';
import { useExportCodecs } from './core/useExportCodecs';
import { useExportFilename } from './core/useExportFilename';
import { useExportProcess } from './core/useExportProcess';

export function useTimelineExport() {
  const state = useExportState();
  const config = useExportConfig();
  const fileSystem = useExportFileSystem();
  const codecs = useExportCodecs();

  const filename = useExportFilename(fileSystem.ensureExportDir, fileSystem.listExportFilenames);

  const process = useExportProcess(
    state.activeExportTaskId,
    state.exportPhase,
    state.exportWarnings,
    state.isExporting,
    state.cancelRequested,
  );

  return {
    ...state,
    ...config,
    ...fileSystem,
    ...codecs,
    ...filename,
    ...process,
  };
}
