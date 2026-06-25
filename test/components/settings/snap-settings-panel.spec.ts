import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import SnapSettingsPanel from '~/components/settings/SnapSettingsPanel.vue';

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    props: ['modelValue', 'min', 'max', 'step', 'unit', 'label', 'defaultValue'],
    emits: ['update:modelValue'],
    template: '<input type="range" class="slider-mock" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
}));

vi.mock('~/composables/timeline/useSnapSettings', () => ({
  useSnapSettings: () => ({
    snapModeOptions: [
      { value: 'off', label: 'Off', icon: 'i-heroicons-x-mark' },
      { value: 'normal', label: 'Normal', icon: 'i-heroicons-magnifying-glass' },
      { value: 'magnetic', label: 'Magnetic', icon: 'i-heroicons-magnet' },
    ],
    isSnapEnabled: true,
    snapThresholdPx: reactive({ value: 8, get: () => 8, set: () => {} }),
    snapToTimelineEdges: reactive({ value: true, get: () => true, set: () => {} }),
    snapToClips: reactive({ value: true, get: () => true, set: () => {} }),
    snapToMarkers: reactive({ value: false, get: () => false, set: () => {} }),
    snapToSelection: reactive({ value: true, get: () => true, set: () => {} }),
    snapToPlayhead: reactive({ value: true, get: () => true, set: () => {} }),
    snapPlayheadOnClick: reactive({ value: false, get: () => false, set: () => {} }),
  }),
}));

const mockSettingsStore = reactive({
  toolbarSnapMode: 'normal',
  selectToolbarSnapMode: vi.fn(),
});

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => mockSettingsStore,
}));

const stubs = {
  UCheckbox: {
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    template: '<input type="checkbox" class="checkbox-mock" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
};

describe('SnapSettingsPanel', () => {
  it('renders snap mode buttons', async () => {
    const component = await mountSuspended(SnapSettingsPanel, {
      global: { stubs },
    });

    const buttons = component.findAll('button');
    expect(buttons.length).toBe(3);
  });

  it('highlights active snap mode', async () => {
    mockSettingsStore.toolbarSnapMode = 'normal';

    const component = await mountSuspended(SnapSettingsPanel, {
      global: { stubs },
    });

    const buttons = component.findAll('button');
    expect(buttons[1].classes()).toContain('bg-primary-500');
  });

  it('calls selectToolbarSnapMode when mode button is clicked', async () => {
    const component = await mountSuspended(SnapSettingsPanel, {
      global: { stubs },
    });

    const buttons = component.findAll('button');
    await buttons[2].trigger('click');

    expect(mockSettingsStore.selectToolbarSnapMode).toHaveBeenCalledWith('magnetic');
  });

  it('renders snap threshold slider', async () => {
    const component = await mountSuspended(SnapSettingsPanel, {
      global: { stubs },
    });

    expect(component.find('.slider-mock').exists()).toBe(true);
  });

  it('renders checkboxes for snap targets', async () => {
    const component = await mountSuspended(SnapSettingsPanel, {
      global: { stubs },
    });

    const checkboxes = component.findAll('.checkbox-mock');
    expect(checkboxes.length).toBe(6);
  });
});
