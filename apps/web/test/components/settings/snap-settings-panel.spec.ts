import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref, computed } from 'vue';
import SnapSettingsPanel from '~/components/settings/SnapSettingsPanel.vue';

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    props: ['modelValue', 'min', 'max', 'step', 'unit', 'label', 'defaultValue'],
    emits: ['update:modelValue'],
    template:
      '<input type="range" class="slider-mock" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
}));

const mockSettingsStore = reactive({
  toolbarSnapMode: 'normal',
  selectToolbarSnapMode: vi.fn(),
});

vi.mock('~/composables/timeline/useSnapSettings', () => ({
  useSnapSettings: () => ({
    snapModeOptions: [
      { value: 'off', label: 'Off', icon: 'i-heroicons-x-mark' },
      { value: 'normal', label: 'Normal', icon: 'i-heroicons-magnifying-glass' },
      { value: 'magnetic', label: 'Magnetic', icon: 'i-heroicons-magnet' },
    ],
    isSnapEnabled: computed(() => mockSettingsStore.toolbarSnapMode !== 'no_snap'),
    snapThresholdPx: reactive({ value: 8, get: () => 8, set: () => {} }),
    snapToTimelineEdges: reactive({ value: true, get: () => true, set: () => {} }),
    snapToClips: reactive({ value: true, get: () => true, set: () => {} }),
    snapToMarkers: reactive({ value: false, get: () => false, set: () => {} }),
    snapToSelection: reactive({ value: true, get: () => true, set: () => {} }),
    snapToPlayhead: reactive({ value: true, get: () => true, set: () => {} }),
    snapPlayheadOnClick: reactive({ value: false, get: () => false, set: () => {} }),
  }),
}));

const stubs = {
  UCheckbox: {
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    template:
      '<input type="checkbox" class="checkbox-mock" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
  USwitch: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input type="checkbox" class="switch-mock" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
  },
};

describe('SnapSettingsPanel', () => {
  beforeEach(() => {
    mockSettingsStore.toolbarSnapMode = 'normal';
    vi.clearAllMocks();
  });

  it('does not render snap mode toggles in settings', async () => {
    const component = await mountSuspended(SnapSettingsPanel, {
      global: { stubs },
    });

    expect(component.findAll('button')).toHaveLength(0);
    expect(component.find('.switch-mock').exists()).toBe(false);
  });

  describe('shared features', () => {
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
});
