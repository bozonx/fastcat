import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SettingsHotkeys from '~/components/settings/SettingsHotkeys.vue';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
  batchUpdateUserSettings: vi.fn(),
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
  },
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

// Mock i18n

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

  it('filters by fallback title when translation differs', async () => {
    vi.mocked(useI18n).mockReturnValue({
      t: vi.fn((key: string, params?: string | Record<string, unknown>) => {
        if (key === 'videoEditor.hotkeys.playback.toggle') return 'Воспроизведение';
        return typeof params === 'string' ? params : key;
      }),
      locale: ref('ru'),
    } as any);

    const wrapper = await mountSuspended(SettingsHotkeys);
    const searchInput = wrapper.find('input[type="text"]');

    // Search by translated title
    await searchInput.setValue('воспроизведение');
    expect(wrapper.text()).not.toContain('common.noResults');

    // Search by English fallback title
    await searchInput.setValue('toggle');
    expect(wrapper.text()).not.toContain('common.noResults');
  });
});
