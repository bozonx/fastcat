import { useProjectStore } from '~/stores/project.store';
import { resolveExportCodecs } from '../codecUtils';

export function useExportSettingsSave(
  config: ReturnType<(typeof import('./useExportConfig'))['useExportConfig']>,
) {
  const projectStore = useProjectStore();

  async function saveProjectSettingsAsDefault() {
    const resolvedCodecs = resolveExportCodecs(
      config.outputFormat.value,
      config.videoCodec.value,
      config.audioCodec.value as 'aac' | 'opus',
    );

    projectStore.projectSettings.project.width = config.normalizedExportWidth.value;
    projectStore.projectSettings.project.height = config.normalizedExportHeight.value;
    projectStore.projectSettings.project.fps = config.normalizedExportFps.value;
    projectStore.projectSettings.project.resolutionFormat = config.resolutionFormat.value;
    projectStore.projectSettings.project.orientation = config.orientation.value;
    projectStore.projectSettings.project.aspectRatio = config.aspectRatio.value;
    projectStore.projectSettings.project.isCustomResolution = config.isCustomResolution.value;
    projectStore.projectSettings.exportDefaults.encoding.format = config.outputFormat.value;
    projectStore.projectSettings.exportDefaults.encoding.videoCodec = resolvedCodecs.videoCodec;
    projectStore.projectSettings.exportDefaults.encoding.bitrateMbps = config.bitrateMbps.value;
    projectStore.projectSettings.exportDefaults.encoding.excludeAudio = config.excludeAudio.value;
    projectStore.projectSettings.exportDefaults.encoding.audioCodec = resolvedCodecs.audioCodec;
    projectStore.projectSettings.exportDefaults.encoding.audioBitrateKbps =
      config.audioBitrateKbps.value;
    projectStore.projectSettings.exportDefaults.encoding.bitrateMode = config.bitrateMode.value;
    projectStore.projectSettings.exportDefaults.encoding.keyframeIntervalSec =
      config.keyframeIntervalSec.value;
    projectStore.projectSettings.exportDefaults.encoding.exportAlpha = config.exportAlpha.value;

    await projectStore.saveProjectSettings();

    await projectStore.saveProjectMeta({
      title: config.metadataTitle.value,
      description: config.metadataDescription.value,
      author: config.metadataAuthor.value,
      tags: config.metadataTags.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  return {
    saveProjectSettingsAsDefault,
  };
}
