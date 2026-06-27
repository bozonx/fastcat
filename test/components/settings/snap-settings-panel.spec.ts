import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref, computed } from 'vue';
import SnapSettingsPanel from '~/components/settings/SnapSettingsPanel.vue';

const isMobileLayout = ref(false);

vi.mock('~/composables/useMobileLayout', () => ({
  useMobileLayout: () => ({ isMobileLayout }),
}));

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

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => mockSettingsStore,
}));

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
    isMobileLayout.value = false;
    vi.clearAllMocks();
  });

  describe('desktop layout', () => {
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
  });

  describe('mobile layout', () => {
    beforeEach(() => {
      isMobileLayout.value = true;
    });

    it('renders switch instead of buttons in mobile layout', async () => {
      const component = await mountSuspended(SnapSettingsPanel, {
        global: { stubs },
      });

      expect(component.findAll('button').length).toBe(0);
      expect(component.find('.switch-mock').exists()).toBe(true);
    });

    it('calls selectToolbarSnapMode with snap when switch is toggled on', async () => {
      mockSettingsStore.toolbarSnapMode = 'no_snap';

      const component = await mountSuspended(SnapSettingsPanel, {
        global: { stubs },
      });

      const toggle = component.find('.switch-mock');
      expect((toggle.element as HTMLInputElement).checked).toBe(false);

      await toggle.setValue(true);
      expect(mockSettingsStore.selectToolbarSnapMode).toHaveBeenCalledWith('snap');
    });

    it('calls selectToolbarSnapMode with no_snap when switch is toggled off', async () => {
      mockSettingsStore.toolbarSnapMode = 'snap';

      const component = await mountSuspended(SnapSettingsPanel, {
        global: { stubs },
      });

      const toggle = component.find('.switch-mock');
      expect((toggle.element as HTMLInputElement).checked).toBe(true);

      await toggle.setValue(false);
      expect(mockSettingsStore.selectToolbarSnapMode).toHaveBeenCalledWith('no_snap');
    });
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
