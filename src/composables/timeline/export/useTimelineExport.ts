import { useExportState } from './core/useExportState';
import { useExportConfig } from './core/useExportConfig';
import { useExportFileSystem } from './core/useExportFileSystem';
import { useExportCodecs } from './core/useExportCodecs';
import { useExportFilename } from './core/useExportFilename';
import { useExportSettingsSave } from './core/useExportSettingsSave';
import { useExportProcess } from './core/useExportProcess';

export function useTimelineExport() {
  const state = useExportState();
  const config = useExportConfig();
  const fileSystem = useExportFileSystem();
  const codecs = useExportCodecs();

  const filename = useExportFilename(
    config.ext,
    fileSystem.ensureExportDir,
    fileSystem.listExportFilenames,
  );

  const settingsSave = useExportSettingsSave(config);

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
    ...settingsSave,
    ...process,
  };
}
