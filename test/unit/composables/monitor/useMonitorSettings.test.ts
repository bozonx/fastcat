import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMonitorSettings } from '~/composables/monitor/useMonitorSettings';
import { ref } from 'vue';

const mockActiveMonitor = ref({
  showTimecode: true,
  showTransparencyGrid: false,
  showMarkerTexts: true,
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
      showMarkerTexts: true,
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

  it('returns default showMarkerTexts value', () => {
    const { showMarkerTexts } = useMonitorSettings();
    expect(showMarkerTexts.value).toBe(true);
  });

  it('toggles showTransparencyGrid', () => {
    const { showTransparencyGrid } = useMonitorSettings();
    showTransparencyGrid.value = true;
    expect(mockActiveMonitor.value.showTransparencyGrid).toBe(true);
  });

  it('toggles showMarkerTexts', () => {
    const { showMarkerTexts } = useMonitorSettings();
    showMarkerTexts.value = false;
    expect(mockActiveMonitor.value.showMarkerTexts).toBe(false);
  });

  it('falls back to defaults when activeMonitor is null', () => {
    mockActiveMonitor.value = null as any;
    const { showTransparencyGrid, showMarkerTexts } = useMonitorSettings();
    expect(showTransparencyGrid.value).toBe(false);
    expect(showMarkerTexts.value).toBe(true);
  });
});
