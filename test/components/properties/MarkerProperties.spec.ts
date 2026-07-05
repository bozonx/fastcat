import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key),
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
    props: ['quickActions', 'additionalActions'],
    template: `
      <div>
        <button
          v-for="action in quickActions"
          :key="'quick-' + action.id"
          :data-testid="'quick-action-' + action.id"
          @click="action.onClick()"
        >
          {{ action.title || action.label }}
        </button>
        <button
          v-for="action in additionalActions"
          :key="'additional-' + action.id"
          :data-testid="'additional-action-' + action.id"
          @click="action.onClick()"
        >
          {{ action.title || action.label }}
        </button>
      </div>
    `,
  },
}));

vi.mock('~/components/ui/UiTextarea.vue', () => ({
  default: {
    name: 'UiTextarea',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<button data-testid="marker-text" :data-value="modelValue" @click="$emit(\'update:modelValue\', \'Updated text\')">text</button>',
  },
}));

vi.mock('~/components/ui/UiColorPicker.vue', () => ({
  default: {
    name: 'UiColorPicker',
    props: ['modelValue', 'mode'],
    emits: ['update:modelValue'],
    template:
      '<button data-testid="marker-color" :data-value="modelValue" @click="$emit(\'update:modelValue\', \'#ff0000\')">color</button>',
  },
}));

vi.mock('~/components/ui/editor/UiTimecode.vue', () => ({
  default: {
    name: 'UiTimecode',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<button class="timecode" :data-value="modelValue" @click="$emit(\'update:modelValue\', Number(modelValue) + 1000000)">timecode</button>',
  },
}));

const timelineStore = reactive({
  markers: [
    { id: 'point', timeUs: 1_000_000, text: 'Point', color: '#eab308' },
    { id: 'zone', timeUs: 2_000_000, durationUs: 4_000_000, text: 'Zone', color: '#4a90e2' },
  ],
  updateMarker: vi.fn(),
  removeMarker: vi.fn(),
  convertMarkerToZone: vi.fn(),
  convertZoneToMarker: vi.fn(),
  convertMarkerToSelectionRange: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));

describe('MarkerProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timelineStore.markers = [
      { id: 'point', timeUs: 1_000_000, text: 'Point', color: '#eab308' },
      { id: 'zone', timeUs: 2_000_000, durationUs: 4_000_000, text: 'Zone', color: '#4a90e2' },
    ];
  });

  it('renders nothing when the marker is missing', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'missing' },
    });

    expect(wrapper.text()).toBe('');
  });

  it('updates marker text and color', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'point' },
    });

    await wrapper.find('[data-testid="marker-text"]').trigger('click');
    await wrapper.find('[data-testid="marker-color"]').trigger('click');

    expect(timelineStore.updateMarker).toHaveBeenCalledWith('point', { text: 'Updated text' });
    expect(timelineStore.updateMarker).toHaveBeenCalledWith('point', { color: '#ff0000' });
  });

  it('updates point marker position from the timecode input', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'point' },
    });

    await wrapper.find('.timecode').trigger('click');

    expect(timelineStore.updateMarker).toHaveBeenCalledWith('point', { timeUs: 2_000_000 });
  });

  it('keeps zone end fixed when the start time changes', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'zone' },
    });

    await wrapper.findAll('.timecode')[0]!.trigger('click');

    expect(timelineStore.updateMarker).toHaveBeenCalledWith('zone', {
      timeUs: 3_000_000,
      durationUs: 3_000_000,
    });
  });

  it('updates zone duration when the end time changes', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'zone' },
    });

    await wrapper.findAll('.timecode')[1]!.trigger('click');

    expect(timelineStore.updateMarker).toHaveBeenCalledWith('zone', {
      durationUs: 5_000_000,
    });
  });

  it('deletes and converts point markers', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'point' },
    });

    await wrapper.find('[data-testid="quick-action-delete"]').trigger('click');
    await wrapper.find('[data-testid="additional-action-convert"]').trigger('click');

    expect(timelineStore.removeMarker).toHaveBeenCalledWith('point');
    expect(timelineStore.convertMarkerToZone).toHaveBeenCalledWith('point');
  });

  it('converts zone markers to point markers and selection ranges', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'zone' },
    });

    await wrapper.find('[data-testid="additional-action-convert"]').trigger('click');
    await wrapper.find('[data-testid="additional-action-convert-to-selection"]').trigger('click');

    expect(timelineStore.convertZoneToMarker).toHaveBeenCalledWith('zone');
    expect(timelineStore.convertMarkerToSelectionRange).toHaveBeenCalledWith('zone');
  });

  it('hides desktop-only actions and color picker when requested', async () => {
    const wrapper = await mountSuspended(MarkerProperties, {
      props: { markerId: 'point', hideActions: true, isMobile: true },
    });

    expect(wrapper.find('[data-testid="quick-action-delete"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="marker-color"]').exists()).toBe(false);
  });
});
