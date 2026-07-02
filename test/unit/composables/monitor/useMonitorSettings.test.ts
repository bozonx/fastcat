import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMonitorSettings } from '~/composables/monitor/useMonitorSettings';
import { ref } from 'vue';

const requestProjectSettingsSaveMock = vi.fn();
const markProjectSettingsAsDirtyMock = vi.fn();
const mockMonitorSettings = ref({
  showTimecode: true,
  showTransparencyGrid: false,
  showMarkerTexts: true,
});

vi.mock('~/stores/project-settings.store', () => ({
  useProjectSettingsStore: () => ({
    projectSettings: {
      monitor: mockMonitorSettings.value,
    },
    markProjectSettingsAsDirty: markProjectSettingsAsDirtyMock,
    requestProjectSettingsSave: requestProjectSettingsSaveMock,
  }),
}));

describe('useMonitorSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMonitorSettings.value = {
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
    expect(mockMonitorSettings.value.showTransparencyGrid).toBe(true);
    expect(markProjectSettingsAsDirtyMock).toHaveBeenCalledTimes(1);
    expect(requestProjectSettingsSaveMock).toHaveBeenCalledTimes(1);
  });

  it('toggles showMarkerTexts', () => {
    const { showMarkerTexts } = useMonitorSettings();
    showMarkerTexts.value = false;
    expect(mockMonitorSettings.value.showMarkerTexts).toBe(false);
  });
});
