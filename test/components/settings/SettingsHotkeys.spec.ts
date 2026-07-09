import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SettingsHotkeys from '~/components/settings/SettingsHotkeys.vue';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
  batchUpdateUserSettings: vi.fn((updater: (draft: typeof DEFAULT_USER_SETTINGS) => void) => {
    updater(mockWorkspaceStore.userSettings);
    return Promise.resolve();
  }),
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
  beforeEach(() => {
    Object.assign(
      mockWorkspaceStore.userSettings,
      JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)),
    );
    mockWorkspaceStore.batchUpdateUserSettings.mockClear();
  });

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

  it('adds captured hotkey without forcing an immediate disk save', async () => {
    const wrapper = await mountSuspended(SettingsHotkeys);
    const addButton = wrapper
      .findAll('button')
      .find((button) => button.classes().includes('h-6') && !button.attributes('aria-label'));

    expect(addButton).toBeDefined();

    await addButton!.trigger('click');
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F9',
        code: 'F9',
        bubbles: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'F9',
        code: 'F9',
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(mockWorkspaceStore.batchUpdateUserSettings).toHaveBeenCalledWith(expect.any(Function));
    expect(mockWorkspaceStore.batchUpdateUserSettings).not.toHaveBeenCalledWith(
      expect.any(Function),
      { immediate: true },
    );
    expect(JSON.stringify(mockWorkspaceStore.userSettings.hotkeys.bindings)).toContain('F9');
  });
});
