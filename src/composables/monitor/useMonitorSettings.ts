import { useLocalStorage } from '@vueuse/core';

const showTimecode = useLocalStorage('fastcat-monitor-show-timecode', true);

export function useMonitorSettings() {
  return {
    showTimecode,
  };
}
