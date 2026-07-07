import { describe, expect, it, vi, beforeEach } from 'vitest';
import { computed, reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TrackProperties from '~/components/properties/TrackProperties.vue';

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: { name: 'PropertySection', template: '<section><slot /></section>' },
}));

vi.mock('~/components/properties/PropertyRow.vue', () => ({
  default: { name: 'PropertyRow', props: ['label', 'value'], template: '<div />' },
}));

vi.mock('~/components/properties/PropertyActionsBlock.vue', () => ({
  default: { name: 'PropertyActionsBlock', template: '<div />' },
}));

vi.mock('~/components/effects/ClipEffectsEditor.vue', () => ({
  default: { name: 'ClipEffectsEditor', template: '<div />' },
}));

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    name: 'UiSliderInput',
    props: {
      modelValue: Number,
      label: String,
      min: Number,
      max: Number,
      step: Number,
      defaultValue: Number,
      decimals: Number,
      unit: String,
      showInputUnit: Boolean,
    },
    emits: ['update:modelValue'],
    template: '<div class="slider-input-stub">{{ modelValue }}{{ unit }}</div>',
  },
}));

vi.mock('~/components/ui/UiConfirmModal.vue', () => ({
  default: { name: 'UiConfirmModal', template: '<div />' },
}));

vi.mock('~/components/ui/UiRenameModal.vue', () => ({
  default: { name: 'UiRenameModal', template: '<div />' },
}));

vi.mock('~/components/ui/UiColorPicker.vue', () => ({
  default: { name: 'UiColorPicker', template: '<div />' },
}));

vi.mock('~/components/properties/GenerateCaptionsModal.vue', () => ({
  default: { name: 'GenerateCaptionsModal', template: '<div />' },
}));

vi.mock('~/composables/properties/useTrackExtraActions', () => ({
  useTrackExtraActions: () => ({ extraActions: computed(() => []) }),
}));

const mockTimelineStore = reactive({
  updateTrackProperties: vi.fn(),
  renameTrack: vi.fn(),
  deleteTrack: vi.fn(),
  toggleTrackAudioMuted: vi.fn(),
  toggleTrackAudioSolo: vi.fn(),
});

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: computed(() => false),
  userSettings: { deleteWithoutConfirmation: true },
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

describe('TrackProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows and edits track volume as percent while storing gain', async () => {
    const wrapper = await mountSuspended(TrackProperties, {
      props: {
        hideActions: true,
        track: {
          id: 'track-1',
          kind: 'audio',
          items: [],
          audioGain: 1.76,
        },
      },
    });

    const volumeSlider = wrapper.findComponent({ name: 'UiSliderInput' });

    expect(volumeSlider.props('modelValue')).toBe(176);
    expect(volumeSlider.props('max')).toBe(200);
    expect(volumeSlider.props('unit')).toBe('%');
    expect(volumeSlider.props('showInputUnit')).toBe(true);

    await volumeSlider.vm.$emit('update:modelValue', 150);

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      audioGain: 1.5,
    });
  });
});
