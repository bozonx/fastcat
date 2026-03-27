import { describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { useMouseSettings } from '~/composables/settings/useMouseSettings';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

// Mock useI18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
  createI18n: vi.fn(),
}));

// Mock useWorkspaceStore
const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
  batchUpdateUserSettings: vi.fn((updater) => {
    updater(mockWorkspaceStore.userSettings);
    return Promise.resolve();
  }),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('useMouseSettings', () => {
  it('calculates modifier names correctly', () => {
    mockWorkspaceStore.userSettings.hotkeys.layer1 = 'Shift';
    const { modifier1Name } = useMouseSettings();
    expect(modifier1Name.value).toBe('Shift (Any)'); // or whatever label is in LAYER_OPTIONS
  });

  it('updates layers via workspaceStore', async () => {
    const { updateLayer1 } = useMouseSettings();
    updateLayer1('Alt');
    expect(mockWorkspaceStore.batchUpdateUserSettings).toHaveBeenCalled();
    expect(mockWorkspaceStore.userSettings.hotkeys.layer1).toBe('Alt');
  });

  it('gets and updates mouse settings', () => {
    const { getSettingValue, updateSetting } = useMouseSettings();
    
    expect(getSettingValue('ruler', 'click')).toBe(DEFAULT_USER_SETTINGS.mouse.ruler.click);
    
    updateSetting('ruler', 'click', 'add_marker');
    expect(mockWorkspaceStore.userSettings.mouse.ruler.click).toBe('add_marker');
    expect(getSettingValue('ruler', 'click')).toBe('add_marker');
  });

  it('detects modifications and defaults', () => {
    const { isDefault, isModified, updateSetting } = useMouseSettings();
    
    const category = 'ruler';
    const key = 'wheel';
    const defaultValue = DEFAULT_USER_SETTINGS.mouse[category][key];

    expect(isDefault(category, key, defaultValue)).toBe(true);
    expect(isModified(category, key)).toBe(false);

    updateSetting(category, key, 'none');
    expect(isModified(category, key)).toBe(true);
  });

  it('resets to defaults', () => {
    const { resetDefaults, updateSetting, getSettingValue } = useMouseSettings();
    
    updateSetting('ruler', 'wheel', 'none');
    resetDefaults();
    
    expect(getSettingValue('ruler', 'wheel')).toBe(DEFAULT_USER_SETTINGS.mouse.ruler.wheel);
  });
});
