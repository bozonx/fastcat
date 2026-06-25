import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import TimelineSnapSettings from '~/components/timeline/TimelineSnapSettings.vue';

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    props: ['modelValue', 'label', 'min', 'max', 'step', 'unit', 'defaultValue'],
    emits: ['update:modelValue'],
    template: '<input type="range" :value="modelValue" :min="min" :max="max" :step="step" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
}));

const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: {
      snapThresholdPx: 10,
      snapping: {
        timelineEdges: true,
        clips: true,
        markers: true,
        selection: true,
        playhead: true,
        playheadClick: true,
      },
    },
  },
});

const mockSettingsStore = reactive({
  setGlobalSnapThresholdPx: vi.fn(),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => mockSettingsStore,
}));

const stubs = {
  UCheckbox: {
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
    template: '<label><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /> {{ label }}</label>',
  },
};

describe('TimelineSnapSettings', () => {
  it('renders snap threshold slider and checkboxes', async () => {
    const component = await mountSuspended(TimelineSnapSettings, {
      global: { stubs },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('input[type="range"]').exists()).toBe(true);
    expect(component.findAll('input[type="checkbox"]').length).toBe(6);
  });

  it('emits setGlobalSnapThresholdPx when slider changes', async () => {
    const component = await mountSuspended(TimelineSnapSettings, {
      global: { stubs },
    });

    await component.find('input[type="range"]').setValue(50);

    expect(mockSettingsStore.setGlobalSnapThresholdPx).toHaveBeenCalledWith(50);
  });

  it('toggles timelineEdges checkbox', async () => {
    const component = await mountSuspended(TimelineSnapSettings, {
      global: { stubs },
    });

    const checkboxes = component.findAll('input[type="checkbox"]');
    await checkboxes[0].setValue(false);

    expect(mockWorkspaceStore.userSettings.timeline.snapping.timelineEdges).toBe(false);
  });

  it('toggles clips checkbox', async () => {
    const component = await mountSuspended(TimelineSnapSettings, {
      global: { stubs },
    });

    const checkboxes = component.findAll('input[type="checkbox"]');
    await checkboxes[1].setValue(false);

    expect(mockWorkspaceStore.userSettings.timeline.snapping.clips).toBe(false);
  });

  it('displays snapping title and description', async () => {
    const component = await mountSuspended(TimelineSnapSettings, {
      global: { stubs },
    });

    expect(component.text()).toContain('videoEditor.settings.snappingTitle');
    expect(component.text()).toContain('videoEditor.settings.snappingDescription');
  });
});
