import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import GapProperties from '~/components/properties/GapProperties.vue';
import { timelineUs } from '../../unit/utils/timeline-time';

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key),
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

vi.mock('~/components/properties/PropertyRow.vue', () => ({
  default: {
    name: 'PropertyRow',
    props: ['label', 'value'],
    template: '<div data-testid="property-row" :data-label="label">{{ value }}</div>',
  },
}));

vi.mock('~/components/properties/PropertyActionsBlock.vue', () => ({
  default: {
    name: 'PropertyActionsBlock',
    props: ['additionalActions'],
    template:
      '<button data-testid="delete-gap" @click="additionalActions[0].onClick()">delete</button>',
  },
}));

vi.mock('~/components/properties/TrackProperties.vue', () => ({
  default: {
    name: 'TrackProperties',
    props: ['track', 'hideActions'],
    template: '<div data-testid="track-props">track</div>',
  },
}));

const timelineStore = reactive({
  timelineDoc: {
    tracks: [
      {
        id: 'track1',
        kind: 'video',
        items: [
          {
            id: 'gap1',
            kind: 'gap',
            timelineRange: { startUs: timelineUs(1_000_000), durationUs: timelineUs(3_000_000) },
          },
        ],
      },
    ],
  },
  timelineFormat: {
    fps: 30,
  },
  applyTimeline: vi.fn(),
  clearSelection: vi.fn(),
});

const selectionStore = reactive({
  clearSelection: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => timelineStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => selectionStore }));

describe('GapProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders track name divider and gap duration correctly', async () => {
    const wrapper = await mountSuspended(GapProperties, {
      props: {
        trackId: 'track1',
        itemId: 'gap1',
        hideActions: false,
      },
    });

    // Check that track name divider is rendered
    expect(wrapper.text()).toContain('fastcat.track.trackName');

    const propertyRow = wrapper.find('[data-testid="property-row"]');
    expect(propertyRow.attributes('data-label')).toBe('common.duration');
    // 3,000_000 Us = 3.0s = 00:00:03:00 at 30 fps
    expect(propertyRow.text()).toBe('00:00:03:00');
  });

  it('deletes gap and clears selection when delete action is clicked', async () => {
    const wrapper = await mountSuspended(GapProperties, {
      props: {
        trackId: 'track1',
        itemId: 'gap1',
        hideActions: false,
      },
    });

    await wrapper.find('[data-testid="delete-gap"]').trigger('click');

    expect(timelineStore.applyTimeline).toHaveBeenCalledWith({
      type: 'delete_items',
      trackId: 'track1',
      itemIds: ['gap1'],
    });
    expect(timelineStore.clearSelection).toHaveBeenCalledOnce();
    expect(selectionStore.clearSelection).toHaveBeenCalledOnce();
  });

  it('hides actions panel when hideActions is true', async () => {
    const wrapper = await mountSuspended(GapProperties, {
      props: {
        trackId: 'track1',
        itemId: 'gap1',
        hideActions: true,
      },
    });

    // Check that the delete button / actions block is not rendered.
    expect(wrapper.find('[data-testid="delete-gap"]').exists()).toBe(false);
  });
});
