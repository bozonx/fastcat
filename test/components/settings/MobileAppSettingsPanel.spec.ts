import { describe, it, expect, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileAppSettingsPanel from '~/components/settings/MobileAppSettingsPanel.vue';

const flushSettingsSavesMock = vi.fn();

const mockWorkspaceStore = reactive({
  userSettings: {
    general: { language: 'en' },
  },
  flushSettingsSaves: flushSettingsSavesMock,
});

const mockUiStore = reactive({
  editorSettingsActiveSection: 'user.general',
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

const globalOptions = {
  stubs: {
    UTabs: {
      props: ['modelValue', 'items'],
      emits: ['update:modelValue'],
      template:
        '<div class="tabs"><button v-for="item in items" :key="item.value" class="tab" :data-value="item.value" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
    },
    SettingsGeneral: { template: '<div class="settings-general" />' },
    SettingsOptimization: { template: '<div class="settings-optimization" />' },
    SettingsExportDefaults: { props: ['isActive'], template: '<div class="settings-export" />' },
    SettingsVideo: { template: '<div class="settings-video" />' },
    SettingsAudio: { template: '<div class="settings-audio" />' },
    SettingsIntegrations: { template: '<div class="settings-integrations" />' },
    SettingsUi: { template: '<div class="settings-ui" />' },
    SettingsStorage: { template: '<div class="settings-storage" />' },
  },
};

describe('MobileAppSettingsPanel', () => {
  it('starts on the general section', async () => {
    mockUiStore.editorSettingsActiveSection = 'user.general';
    const wrapper = await mountSuspended(MobileAppSettingsPanel, { global: globalOptions });
    expect(wrapper.find('.settings-general').exists()).toBe(true);
  });

  it('flushes settings saves on unmount', async () => {
    const wrapper = await mountSuspended(MobileAppSettingsPanel, { global: globalOptions });
    wrapper.unmount();
    expect(flushSettingsSavesMock).toHaveBeenCalled();
  });

  it('switches to the selected section', async () => {
    const wrapper = await mountSuspended(MobileAppSettingsPanel, { global: globalOptions });
    await wrapper.find('[data-value="user.audio"]').trigger('click');
    expect(wrapper.find('.settings-audio').exists()).toBe(true);
  });

  it('saves the active section to the ui store', async () => {
    const wrapper = await mountSuspended(MobileAppSettingsPanel, { global: globalOptions });
    await wrapper.find('[data-value="user.ui"]').trigger('click');
    expect(mockUiStore.editorSettingsActiveSection).toBe('user.ui');
  });
});
