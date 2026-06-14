import { computed } from 'vue';
import { useProjectSettingsStore } from '~/stores/project-settings.store';

export function useMonitorSettings() {
  const projectSettingsStore = useProjectSettingsStore();

  const showTimecode = computed({
    get: () => projectSettingsStore.activeMonitor?.showTimecode ?? true,
    set: (val) => {
      if (projectSettingsStore.activeMonitor) {
        projectSettingsStore.activeMonitor.showTimecode = val;
      }
    },
  });

  const showTransparencyGrid = computed({
    get: () => projectSettingsStore.activeMonitor?.showTransparencyGrid ?? false,
    set: (val) => {
      if (projectSettingsStore.activeMonitor) {
        projectSettingsStore.activeMonitor.showTransparencyGrid = val;
      }
    },
  });

  const showMarkerTexts = computed({
    get: () => projectSettingsStore.activeMonitor?.showMarkerTexts ?? true,
    set: (val) => {
      if (projectSettingsStore.activeMonitor) {
        projectSettingsStore.activeMonitor.showMarkerTexts = val;
      }
    },
  });

  return {
    showTimecode,
    showTransparencyGrid,
    showMarkerTexts,
  };
}
