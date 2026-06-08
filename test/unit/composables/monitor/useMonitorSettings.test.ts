import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMonitorSettings } from '~/composables/monitor/useMonitorSettings';
import { ref } from 'vue';

const mockActiveMonitor = ref({
  showTimecode: true,
  showTransparencyGrid: false,
});

vi.mock('~/stores/project-settings.store', () => ({
  useProjectSettingsStore: () => ({
    activeMonitor: mockActiveMonitor.value,
  }),
}));

describe('useMonitorSettings', () => {
  beforeEach(() => {
    mockActiveMonitor.value = {
      showTimecode: true,
      showTransparencyGrid: false,
    };
  });

  it('returns default showTimecode value', () => {
    const { showTimecode } = useMonitorSettings();
    expect(showTimecode.value).toBe(true);
  });

  it('returns default showTransparencyGrid value', () => {
    const { showTransparencyGrid } = useMonitorSettings();
    expect(showTransparencyGrid.value).toBe(false);
  });

  it('toggles showTransparencyGrid', () => {
    const { showTransparencyGrid } = useMonitorSettings();
    showTransparencyGrid.value = true;
    expect(mockActiveMonitor.value.showTransparencyGrid).toBe(true);
  });

  it('falls back to false when activeMonitor is null', () => {
    mockActiveMonitor.value = null as any;
    const { showTransparencyGrid } = useMonitorSettings();
    expect(showTransparencyGrid.value).toBe(false);
  });
});
