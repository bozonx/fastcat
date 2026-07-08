import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, nextTick, ref } from 'vue';
import SettingsGeneral from '~/components/settings/SettingsGeneral.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const isMobileLayout = ref(false);

const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
  inDevelopmentFeaturesEnabled: true,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/composables/useMobileLayout', () => ({
  useMobileLayout: () => ({ isMobileLayout }),
}));

vi.mock('~/stores/ui/uiLocalStorage', () => ({
  clearUiCache: vi.fn(),
}));

describe('SettingsGeneral', () => {
  beforeEach(() => {
    isMobileLayout.value = false;
  });

  it('preserves locale when resetting general defaults', async () => {
    mockWorkspaceStore.userSettings.locale = 'ru-RU';
    mockWorkspaceStore.userSettings.openLastProjectOnStart = true;
    mockWorkspaceStore.userSettings.deleteWithoutConfirmation = true;
    mockWorkspaceStore.userSettings.experimentalFeatures = true;
    mockWorkspaceStore.userSettings.stopFrames.qualityPercent = 50;
    mockWorkspaceStore.userSettings.timeline.defaultTransitionDurationUs = 1_000_000;
    mockWorkspaceStore.userSettings.timeline.defaultStaticClipDurationUs = 1_000_000;
    mockWorkspaceStore.userSettings.ui.interfaceScale = 20;
    mockWorkspaceStore.userSettings.history.maxEntries = 999;
    mockWorkspaceStore.userSettings.backup.enabled = false;
    mockWorkspaceStore.userSettings.backup.count = 99;
    mockWorkspaceStore.userSettings.autosave.intervalMinutes = 60;

    const wrapper = await mountSuspended(SettingsGeneral);

    const resetButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('videoEditor.settings.resetDefaults'));

    expect(resetButton?.exists()).toBe(true);
    await resetButton?.trigger('click');
    await nextTick();

    const modal = wrapper.findComponent({ name: 'UiConfirmModal' });
    expect(modal.exists()).toBe(true);
    await modal.vm.$emit('confirm');

    expect(mockWorkspaceStore.userSettings.locale).toBe('ru-RU');
    expect(mockWorkspaceStore.userSettings.openLastProjectOnStart).toBe(
      DEFAULT_USER_SETTINGS.openLastProjectOnStart,
    );
    expect(mockWorkspaceStore.userSettings.deleteWithoutConfirmation).toBe(
      DEFAULT_USER_SETTINGS.deleteWithoutConfirmation,
    );
    expect(mockWorkspaceStore.userSettings.stopFrames.qualityPercent).toBe(
      DEFAULT_USER_SETTINGS.stopFrames.qualityPercent,
    );
    expect(mockWorkspaceStore.userSettings.timeline.defaultTransitionDurationUs).toBe(
      DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationUs,
    );
    expect(mockWorkspaceStore.userSettings.timeline.defaultStaticClipDurationUs).toBe(
      DEFAULT_USER_SETTINGS.timeline.defaultStaticClipDurationUs,
    );
    expect(mockWorkspaceStore.userSettings.ui.interfaceScale).toBe(
      DEFAULT_USER_SETTINGS.ui.interfaceScale,
    );
    expect(mockWorkspaceStore.userSettings.history.maxEntries).toBe(
      DEFAULT_USER_SETTINGS.history.maxEntries,
    );
    expect(mockWorkspaceStore.userSettings.backup.enabled).toBe(
      DEFAULT_USER_SETTINGS.backup.enabled,
    );
    expect(mockWorkspaceStore.userSettings.backup.count).toBe(DEFAULT_USER_SETTINGS.backup.count);
    expect(mockWorkspaceStore.userSettings.autosave.intervalMinutes).toBe(
      DEFAULT_USER_SETTINGS.autosave.intervalMinutes,
    );
  });

  it('hides autosave interval setting in mobile layout', async () => {
    isMobileLayout.value = true;

    const wrapper = await mountSuspended(SettingsGeneral);

    expect(wrapper.text()).not.toContain('videoEditor.settings.autosaveInterval');
  });
});
