import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import SettingsHotkeys from '~/components/settings/SettingsHotkeys.vue';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
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

describe('SettingsHotkeys', () => {
  it('renders hotkey groups and search input', async () => {
    const wrapper = await mountSuspended(SettingsHotkeys);
    
    expect(wrapper.find('input[type="text"]').exists()).toBe(true);
    // Should have some group titles
    expect(wrapper.text()).toContain('videoEditor.settings.hotkeysGroupGeneral');
  });

  it('filters results based on search query', async () => {
    const wrapper = await mountSuspended(SettingsHotkeys);
    const searchInput = wrapper.find('input[type="text"]');
    
    // Type something that doesn't exist
    await searchInput.setValue('non-existent-command-xyz');
    expect(wrapper.text()).toContain('common.noResults');
    
    // Type something that exists (all keys are mocked to be their translation key)
    // Part of the translation key for any command
    await searchInput.setValue('toggle'); 
    expect(wrapper.text()).not.toContain('common.noResults');
  });
});
