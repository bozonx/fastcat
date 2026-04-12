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

  return {
    showTimecode,
  };
}
