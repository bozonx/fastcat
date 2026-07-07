import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MultiMarkerProperties from '~/components/properties/MultiMarkerProperties.vue';

vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(() => ({
    global: {
      locale: ref('en-US'),
      t: (key: string) => key,
    },
    install: vi.fn(),
  })),
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string, params?: Record<string, unknown>) =>
      params?.count === undefined ? key : `${key}:${params.count}`,
    ),
    locale: ref('en-US'),
  })),
}));

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: {
    name: 'PropertySection',
    props: ['title'],
    template: '<section :data-title="title"><slot /></section>',
  },
}));

vi.mock('~/components/properties/PropertyActionsBlock.vue', () => ({
  default: {
    name: 'PropertyActionsBlock',
    props: ['quickActions'],
    template: '<button data-testid="delete-all" @click="quickActions[0].onClick()">delete</button>',
  },
}));

vi.mock('~/components/ui/UiColorPicker.vue', () => ({
  default: {
    name: 'UiColorPicker',
    props: ['modelValue', 'mode'],
    emits: ['update:modelValue'],
    template:
      '<button data-testid="color-picker" :data-value="modelValue" @click="$emit(\'update:modelValue\', \'#ff0000\')">color</button>',
  },
}));

const timelineStore = reactive({
  markers: [
    { id: 'm1', timeUs: 1_000_000, text: 'Intro', color: '#eab308' },
    { id: 'm2', timeUs: 2_000_000, text: 'Beat', color: '#eab308' },
    { id: 'm3', timeUs: 3_000_000, text: 'Outro', color: '#00ff00' },
  ],
  batchApplyTimeline: vi.fn(),
});

const selectionStore = reactive({
  clearSelection: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));

describe('MultiMarkerProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes all selected markers and clears selection', async () => {
    const wrapper = await mountSuspended(MultiMarkerProperties, {
      props: { markerIds: ['m1', 'm2'] },
    });

    await wrapper.find('[data-testid="delete-all"]').trigger('click');

    expect(timelineStore.batchApplyTimeline).toHaveBeenCalledWith([
      { type: 'remove_marker', id: 'm1' },
      { type: 'remove_marker', id: 'm2' },
    ]);
    expect(selectionStore.clearSelection).toHaveBeenCalledOnce();
  });

  it('applies color to all selected markers', async () => {
    const wrapper = await mountSuspended(MultiMarkerProperties, {
      props: { markerIds: ['m1', 'm3'] },
    });

    await wrapper.find('[data-testid="color-picker"]').trigger('click');

    expect(timelineStore.batchApplyTimeline).toHaveBeenCalledWith(
      [
        { type: 'update_marker', id: 'm1', color: '#ff0000' },
        { type: 'update_marker', id: 'm3', color: '#ff0000' },
      ],
      { historyMode: 'debounced' },
    );
  });

  it('uses the shared color when selected markers have the same color', async () => {
    const wrapper = await mountSuspended(MultiMarkerProperties, {
      props: { markerIds: ['m1', 'm2'] },
    });

    expect(wrapper.find('[data-testid="color-picker"]').attributes('data-value')).toBe('#eab308');
  });
});
