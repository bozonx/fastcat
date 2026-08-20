import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import SettingsUi from '~/components/settings/SettingsUi.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

vi.mock('~/components/ui/UiFormField.vue', () => ({
  default: {
    props: ['label'],
    template: '<div class="form-field-mock"><label>{{ label }}</label><slot /></div>',
  },
}));

vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: {
    props: ['modelValue', 'items', 'valueKey', 'labelKey', 'fullWidth'],
    emits: ['update:modelValue'],
    template:
      '<select class="select-mock" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option></select>',
  },
}));

vi.mock('~/components/ui/UiConfirmModal.vue', () => ({
  default: {
    name: 'UiConfirmModal',
    template: '<div><slot /></div>',
  },
}));

const mockWorkspaceStore = reactive({
  userSettings: {
    ui: {
      interfaceScale: 14,
      clipThumbnailMode: 'standard',
      defaultAudioWaveformMode: 'half',
    },
  },
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('SettingsUi', () => {
  it('renders UI settings section', async () => {
    const component = await mountSuspended(SettingsUi);

    expect(component.exists()).toBe(true);
  });

  it('renders clip thumbnail mode select', async () => {
    const component = await mountSuspended(SettingsUi);

    const selects = component.findAll('.select-mock');
    expect(selects.length).toBe(2);
  });

  it('renders thumbnail mode options', async () => {
    const component = await mountSuspended(SettingsUi);

    const options = component.findAll('option');
    expect(options.length).toBe(6);
  });

  it('updates clipThumbnailMode when select changes', async () => {
    const component = await mountSuspended(SettingsUi);

    const selects = component.findAll('.select-mock');
    await selects[0].setValue('none');

    expect(mockWorkspaceStore.userSettings.ui.clipThumbnailMode).toBe('none');
  });

  it('updates defaultAudioWaveformMode when select changes', async () => {
    const component = await mountSuspended(SettingsUi);

    const selects = component.findAll('.select-mock');
    await selects[1].setValue('full');

    expect(mockWorkspaceStore.userSettings.ui.defaultAudioWaveformMode).toBe('full');
  });

  it('resets UI settings to defaults', async () => {
    mockWorkspaceStore.userSettings.ui.clipThumbnailMode = 'none';
    mockWorkspaceStore.userSettings.ui.defaultAudioWaveformMode = 'full';

    const component = await mountSuspended(SettingsUi);
    await component.find('button').trigger('click');
    await component.findComponent({ name: 'UiConfirmModal' }).vm.$emit('confirm');

    expect(mockWorkspaceStore.userSettings.ui).toEqual(DEFAULT_USER_SETTINGS.ui);
  });
});
