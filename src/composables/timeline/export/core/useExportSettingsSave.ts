import { useProjectStore } from '~/stores/project.store';

export function useExportSettingsSave(
  config: ReturnType<(typeof import('./useExportConfig'))['useExportConfig']>,
) {
  const projectStore = useProjectStore();

  async function saveProjectSettingsAsDefault() {
    const isAudio = config.exportType.value === 'audio';

    projectStore.projectSettings.project.sampleRate = config.audioSampleRate.value;

    if (!isAudio) {
      projectStore.projectSettings.project.width = config.normalizedExportWidth.value;
      projectStore.projectSettings.project.height = config.normalizedExportHeight.value;
      projectStore.projectSettings.project.fps = config.normalizedExportFps.value;
      projectStore.projectSettings.project.resolutionFormat = config.resolutionFormat.value;
      projectStore.projectSettings.project.orientation = config.orientation.value;
      projectStore.projectSettings.project.aspectRatio = config.aspectRatio.value;
      projectStore.projectSettings.project.isCustomResolution = config.isCustomResolution.value;
      projectStore.projectSettings.project.isAutoSettings = true;
    }

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
