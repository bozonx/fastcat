import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import SettingsMouse from '~/components/settings/SettingsMouse.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
  batchUpdateUserSettings: vi.fn(),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

// Mock i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
  createI18n: vi.fn(),
}));

describe('SettingsMouse', () => {
  it('renders mouse sections and reset button', async () => {
    const wrapper = await mountSuspended(SettingsMouse);
    
    expect(wrapper.text()).toContain('videoEditor.settings.userMouse');
    expect(wrapper.text()).toContain('videoEditor.settings.resetDefaults');
    
    // Check for some section titles
    expect(wrapper.text()).toContain('videoEditor.settings.mouseRuler');
    expect(wrapper.text()).toContain('videoEditor.settings.mouseTimeline');
  });

  it('updates layer 1 when selected', async () => {
    const wrapper = await mountSuspended(SettingsMouse);
    
    // Find first UiSelect (layer 1)
    const selects = wrapper.findAllComponents({ name: 'UiSelect' });
    expect(selects.length).toBeGreaterThanOrEqual(2);
    
    await selects[0].vm.$emit('update:model-value', 'Alt');
    // useMouseSettings.updateLayer1 calls batchUpdateUserSettings
    expect(mockWorkspaceStore.batchUpdateUserSettings).toHaveBeenCalled();
  });
});
