import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, nextTick, toRef } from 'vue';
import { defineStore } from 'pinia';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';

vi.mock('~/components/timeline/TimelineClip.vue', () => ({
  default: {
    name: 'TimelineClip',
    template: '<div class="mock-timeline-clip" :data-item-id="item.id"><slot /></div>',
    props: ['item', 'track'],
  },
}));
vi.mock('~/components/timeline/TimelineGap.vue', () => ({
  default: {
    name: 'TimelineGap',
    template: '<div class="mock-timeline-gap" :data-item-id="item.id"><slot /></div>',
    props: ['item', 'trackId'],
  },
}));
vi.mock('~/components/timeline/TimelineSpeedModal.vue', () => ({
  default: { name: 'TimelineSpeedModal', template: '<div></div>' },
}));

const selectTrackSpy = vi.fn();
const clearSelectionSpy = vi.fn();
const selectTimelinePropertiesSpy = vi.fn();
const selectTimelineTrackSpy = vi.fn();

const useMockTimelineStore = defineStore('timeline-mock', {
  state: () => ({
    timelineZoom: 1,
    duration: 10000000,
    currentTime: 0,
    selectedTrackId: null as string | null,
    hoveredTrackId: null as string | null,
    selectedTransition: null as any,
  }),
  actions: {
    getSelectionRange: () => null,
    selectTrack: selectTrackSpy,
    clearSelection: clearSelectionSpy,
    selectTimelineProperties: selectTimelinePropertiesSpy,
  },
});

const useMockSelectionStore = defineStore('selection-mock', {
  state: () => ({
    selectedEntity: null as any,
  }),
  actions: {
    isTrackVisuallySelected: (id: string) => id === 'selected-track',
    clearSelection: clearSelectionSpy,
    selectTimelineTrack: selectTimelineTrackSpy,
    selectTimelineProperties: selectTimelinePropertiesSpy,
  },
});

const mockMediaStore = reactive({
  mediaMetadata: {},
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => useMockTimelineStore() }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => useMockSelectionStore() }));
vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => ({
    mediaMetadata: {},
  }),
}));

// Pinia is already initialized in vitest.setup.ts

// Mock Composables used inside TimelineTracks
vi.mock('~/composables/timeline/useTimelineItemResize', () => ({
  useTimelineItemResize: () => ({
    resizeVolume: null,
    startResizeVolume: vi.fn(),
    startResizeFade: vi.fn(),
    startResizeTransition: vi.fn(),
  }),
}));

vi.mock('~/composables/timeline/useTimelineMarquee', () => ({
  useTimelineMarquee: () => ({
    isMarqueeSelecting: false,
    marqueeStyle: {},
    startMarquee: vi.fn(),
  }),
}));

describe('TimelineTracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const timelineStore = useMockTimelineStore();
    timelineStore.timelineZoom = 50;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseTracks = [
    {
      id: 'track-1',
      kind: 'video',
      items: [
        { id: 'clip-1', kind: 'clip', timelineRange: { startUs: 0, durationUs: 5000000 } },
        { id: 'gap-1', kind: 'gap', timelineRange: { startUs: 5000000, durationUs: 2000000 } },
      ],
    },
    {
      id: 'track-2',
      kind: 'audio',
      items: [
        { id: 'clip-2', kind: 'clip', timelineRange: { startUs: 1000000, durationUs: 3000000 } },
      ],
    },
  ];

  const defaultProps = {
    tracks: baseTracks,
    trackHeights: { 'track-1': 50, 'track-2': 40 },
    canEditClipContent: true,
  };

  it('renders tracks and items correctly', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: defaultProps,
    });

    const track1 = component.find('[data-track-id="track-1"]');
    const track2 = component.find('[data-track-id="track-2"]');

    expect(track1.exists()).toBe(true);
    expect(track2.exists()).toBe(true);

    expect(track1.attributes('style')).toContain('height: 50px');
    expect(track2.attributes('style')).toContain('height: 40px');

    const clips = component.findAll('.mock-timeline-clip');
    expect(clips.length).toBe(2);

    const gaps = component.findAll('.mock-timeline-gap');
    expect(gaps.length).toBe(1);
  });

  it('handles track click selection', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: defaultProps,
    });

    const track1 = component.find('[data-track-id="track-1"]');
    // Start marquee triggers selection in this component when clicking the background
    // Let's test the click on the bottom spacer
    const bottomSpacer = component.find('.flex-1.min-h-7');
    await bottomSpacer.trigger('click');

    expect(selectTrackSpy).toHaveBeenCalledWith(null);
  });

  it('selects mobile track on tap without long press flow', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        isMobile: true,
      },
    });

    const track = component.find('[data-track-id="track-1"]');

    await track.trigger('pointerdown', {
      button: 0,
      clientX: 24,
      clientY: 12,
      pointerType: 'touch',
    });
    await track.trigger('click', {
      clientX: 24,
      clientY: 12,
    });

    await nextTick();

    expect(selectTrackSpy).toHaveBeenCalledWith('track-1');
    expect(selectTimelineTrackSpy).toHaveBeenCalledWith('track-1');
    expect(clearSelectionSpy).toHaveBeenCalled();
  });

  it('does not emit mobile track long press event', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        isMobile: true,
      },
    });

    const track = component.find('[data-track-id="track-1"]');

    await track.trigger('pointerdown', {
      button: 0,
      clientX: 24,
      clientY: 12,
      pointerType: 'touch',
    });

    await nextTick();

    expect(component.emitted('long-press-track')).toBeFalsy();
  });

  it('renders only items intersecting the visible viewport while keeping overlapping clips', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks: [
          {
            id: 'track-1',
            kind: 'video',
            items: [
              {
                id: 'clip-overlap',
                kind: 'clip',
                timelineRange: { startUs: 0, durationUs: 80_000_000 },
              },
              {
                id: 'clip-hidden-left',
                kind: 'clip',
                timelineRange: { startUs: 10_000_000, durationUs: 5_000_000 },
              },
              {
                id: 'clip-visible',
                kind: 'clip',
                timelineRange: { startUs: 65_000_000, durationUs: 10_000_000 },
              },
            ],
          },
        ],
        trackHeights: { 'track-1': 50 },
        scrollLeft: 500,
        viewportWidth: 100,
      },
    });

    const renderedClipIds = component
      .findAll('.mock-timeline-clip')
      .map((clip) => clip.attributes('data-item-id'));

    expect(renderedClipIds).toEqual(['clip-overlap', 'clip-hidden-left', 'clip-visible']);
  });

  it('falls back to full visibility filtering when items are not sorted by start time', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks: [
          {
            id: 'track-1',
            kind: 'video',
            items: [
              {
                id: 'clip-visible',
                kind: 'clip',
                timelineRange: { startUs: 65_000_000, durationUs: 10_000_000 },
              },
              {
                id: 'clip-overlap',
                kind: 'clip',
                timelineRange: { startUs: 0, durationUs: 80_000_000 },
              },
              {
                id: 'clip-hidden-left',
                kind: 'clip',
                timelineRange: { startUs: 10_000_000, durationUs: 5_000_000 },
              },
            ],
          },
        ],
        trackHeights: { 'track-1': 50 },
        scrollLeft: 500,
        viewportWidth: 100,
      },
    });

    const renderedClipIds = component
      .findAll('.mock-timeline-clip')
      .map((clip) => clip.attributes('data-item-id'));

    expect(renderedClipIds).toEqual(['clip-visible', 'clip-overlap', 'clip-hidden-left']);
  });

  it('displays drag previews when provided', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        dragPreview: {
          trackId: 'track-1',
          startUs: 0,
          label: 'Dragging Clip',
          durationUs: 1000000,
          kind: 'timeline-clip',
        },
      },
    });

    const preview = component.find('[data-track-id="track-1"] .absolute.top-0\\.5');
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain('Dragging Clip');
  });

  it('renders preview ghosts for every clip in a moved group', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        movePreview: [
          {
            itemId: 'clip-1',
            trackId: 'track-1',
            startUs: 500000,
            isCollision: false,
          },
          {
            itemId: 'clip-2',
            trackId: 'track-2',
            startUs: 1500000,
            isCollision: false,
          },
        ],
      },
    });

    const renderedClipIds = component
      .findAll('.mock-timeline-clip')
      .map((clip) => clip.attributes('data-item-id'));

    expect(renderedClipIds).toContain('preview-clip-1');
    expect(renderedClipIds).toContain('preview-clip-2');
  });
});
