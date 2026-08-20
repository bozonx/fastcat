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

describe('SettingsGeneral', () => {
  beforeEach(() => {
    isMobileLayout.value = false;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('preserves locale when resetting general defaults', async () => {
    mockWorkspaceStore.userSettings.locale = 'ru-RU';
    mockWorkspaceStore.userSettings.openLastProjectOnStart = true;
    mockWorkspaceStore.userSettings.deleteWithoutConfirmation = true;
    mockWorkspaceStore.userSettings.experimentalFeatures = true;
    mockWorkspaceStore.userSettings.stopFrames.qualityPercent = 50;
    mockWorkspaceStore.userSettings.timeline.defaultAudioFadeDurationTicks = 635_040_000_000;
    mockWorkspaceStore.userSettings.timeline.defaultTransitionDurationTicks = 254_016_000_000;
    mockWorkspaceStore.userSettings.timeline.defaultStaticClipDurationTicks = 254_016_000_000;
    mockWorkspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve = 'logarithmic';
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
    expect(mockWorkspaceStore.userSettings.timeline.defaultAudioFadeDurationTicks).toBe(
      DEFAULT_USER_SETTINGS.timeline.defaultAudioFadeDurationTicks,
    );
    expect(mockWorkspaceStore.userSettings.timeline.defaultTransitionDurationTicks).toBe(
      DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationTicks,
    );
    expect(mockWorkspaceStore.userSettings.timeline.defaultStaticClipDurationTicks).toBe(
      DEFAULT_USER_SETTINGS.timeline.defaultStaticClipDurationTicks,
    );
    expect(mockWorkspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve).toBe(
      DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve,
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

  it('hides autosave interval setting in desktop web', async () => {
    const wrapper = await mountSuspended(SettingsGeneral);

    expect(wrapper.text()).not.toContain('videoEditor.settings.autosaveInterval');
  });

  it('hides backup settings in automatic-save modes', async () => {
    const wrapper = await mountSuspended(SettingsGeneral);

    expect(wrapper.text()).not.toContain('videoEditor.settings.useBackups');
    expect(wrapper.text()).not.toContain('videoEditor.settings.backupCount');
  });

  it('keeps backup settings in native desktop', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mockWorkspaceStore.userSettings.backup.enabled = true;
    const wrapper = await mountSuspended(SettingsGeneral);

    expect(wrapper.text()).toContain('videoEditor.settings.useBackups');
    expect(wrapper.text()).toContain('videoEditor.settings.backupCount');
  });

  it('hides interface scale setting in mobile layout', async () => {
    isMobileLayout.value = true;

    const wrapper = await mountSuspended(SettingsGeneral);

    expect(wrapper.text()).not.toContain('videoEditor.settings.uiInterfaceScale');
  });

  it('hides Advanced accordion when no advanced settings are available (web)', async () => {
    const wrapper = await mountSuspended(SettingsGeneral);

    expect(wrapper.text()).not.toContain('videoEditor.settings.advancedSection');
  });

  it('shows Advanced accordion in native desktop', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const wrapper = await mountSuspended(SettingsGeneral);

    expect(wrapper.text()).toContain('videoEditor.settings.advancedSection');
  });

  it('lists Spanish (Latin America) as a selectable interface language', async () => {
    const wrapper = await mountSuspended(SettingsGeneral);

    const select = wrapper.findComponent({ name: 'UiSelect' });
    expect(select.exists()).toBe(true);
    const items = select.props('items') as { label: string; value: string }[];
    expect(items).toContainEqual({ label: 'Español (Latinoamérica)', value: 'es-419' });
  });

  it('persists es-419 when the language selector emits it', async () => {
    const wrapper = await mountSuspended(SettingsGeneral);
    const select = wrapper.findComponent({ name: 'UiSelect' });

    await select.vm.$emit('update:modelValue', {
      label: 'Español (Latinoamérica)',
      value: 'es-419',
    });
    await nextTick();

    expect(mockWorkspaceStore.userSettings.locale).toBe('es-419');
  });
});
