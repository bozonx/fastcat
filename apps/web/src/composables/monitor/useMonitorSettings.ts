import { computed } from 'vue';
import { useProjectSettingsStore } from '~/stores/project-settings.store';
import type { ProjectMonitorSettings } from '~/utils/project-settings';

export function useMonitorSettings() {
  const projectSettingsStore = useProjectSettingsStore();

  function setMonitorSetting<K extends keyof ProjectMonitorSettings>(
    key: K,
    value: ProjectMonitorSettings[K],
  ) {
    projectSettingsStore.projectSettings.monitor[key] = value;
    projectSettingsStore.markProjectSettingsAsDirty();
    void projectSettingsStore.requestProjectSettingsSave();
  }

  const showTimecode = computed({
    get: () => projectSettingsStore.projectSettings.monitor.showTimecode ?? true,
    set: (val) => {
      setMonitorSetting('showTimecode', val);
    },
  });

  const showTransparencyGrid = computed({
    get: () => projectSettingsStore.projectSettings.monitor.showTransparencyGrid ?? false,
    set: (val) => {
      setMonitorSetting('showTransparencyGrid', val);
    },
  });

  const showMarkerTexts = computed({
    get: () => projectSettingsStore.projectSettings.monitor.showMarkerTexts ?? true,
    set: (val) => {
      setMonitorSetting('showMarkerTexts', val);
    },
  });

  return {
    showTimecode,
    showTransparencyGrid,
    showMarkerTexts,
  };
}
