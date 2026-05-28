import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSuspended, mockComponent } from '@nuxt/test-utils/runtime';
import { reactive, nextTick, toRef } from 'vue';
import { defineStore } from 'pinia';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import { useUiStore } from '~/stores/ui.store';
import { useAppClipboard } from '~/composables/useAppClipboard';

mockComponent('UContextMenu', {
  template: '<div><slot /></div>',
});
mockComponent('UDropdownMenu', {
  template: '<div><slot /></div>',
});

vi.mock('~/components/timeline/TimelineClip.vue', () => ({
  default: {
    name: 'TimelineClip',
    template:
      '<div class="mock-timeline-clip" :data-clip-id="item.id" :data-item-id="item.id" :data-start-us="item.timelineRange.startUs" :data-duration-us="item.timelineRange.durationUs" :data-locked="item.locked" :data-disabled="item.disabled" :data-audio-muted="item.audioMuted" :data-show-waveform="item.showWaveform" :data-show-thumbnails="item.showThumbnails" :data-waveform-mode="item.audioWaveformMode" :data-is-move-preview="isMovePreviewCurrentItem" :data-has-slip-preview="Boolean(slipPreview)"><slot /></div>',
    props: ['item', 'track', 'isMovePreviewCurrentItem', 'slipPreview'],
  },
}));
vi.mock('~/components/timeline/TimelineGap.vue', () => ({
  default: {
    name: 'TimelineGap',
    template:
      '<div class="mock-timeline-gap" :data-gap-id="item.id" :data-item-id="item.id" :data-start-us="item.timelineRange.startUs" :data-duration-us="item.timelineRange.durationUs"><slot /></div>',
    props: ['item', 'trackId'],
  },
}));
vi.mock('~/components/timeline/TimelineSpeedModal.vue', () => ({
  default: { name: 'TimelineSpeedModal', template: '<div></div>' },
}));
vi.mock('~/components/timeline/AutoMontageModal.vue', () => ({
  default: { name: 'AutoMontageModal', template: '<div></div>', props: ['open'] },
}));
vi.mock('~/components/properties/clip/ClipParametersPasteModal.vue', () => ({
  default: { name: 'ClipParametersPasteModal', template: '<div></div>', props: ['open'] },
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
vi.mock('~/composables/timeline/useTimelineClipHandleResize', () => ({
  useTimelineClipHandleResize: () => ({
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

  it('does not clear the clip selection when pressing a clip to start a group drag (desktop)', async () => {
    // Clips bubble their pointerdown up to the track. The track handler must not
    // treat that as a background press and clear the clip selection — otherwise a
    // pre-existing multi-selection is wiped before the group drag begins and only
    // the grabbed clip moves.
    const component = await mountSuspended(TimelineTracks, {
      props: defaultProps,
    });

    const clip = component.find('[data-clip-id="clip-1"]');
    expect(clip.exists()).toBe(true);

    await clip.trigger('pointerdown', {
      button: 0,
      clientX: 30,
      clientY: 12,
      pointerType: 'mouse',
    });
    await nextTick();

    expect(clearSelectionSpy).not.toHaveBeenCalled();
    expect(selectTrackSpy).not.toHaveBeenCalledWith('track-1');
  });

  it('does not clear the clip selection when pressing a gap (desktop)', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: defaultProps,
    });

    const gap = component.find('[data-gap-id="gap-1"]');
    expect(gap.exists()).toBe(true);

    await gap.trigger('pointerdown', {
      button: 0,
      clientX: 30,
      clientY: 12,
      pointerType: 'mouse',
    });
    await nextTick();

    expect(clearSelectionSpy).not.toHaveBeenCalled();
    expect(selectTrackSpy).not.toHaveBeenCalledWith('track-1');
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

  it('keeps the original clip visible for slip preview instead of rendering a move ghost', async () => {
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        draggingMode: 'slip',
        movePreview: [
          {
            itemId: 'clip-1',
            trackId: 'track-1',
            startUs: 500000,
            isCollision: false,
          },
        ],
        slipPreview: {
          itemId: 'clip-1',
          trackId: 'track-1',
          deltaUs: 500000,
          timecode: '+00-00-00-15',
        },
      },
    });

    const renderedClipIds = component
      .findAll('.mock-timeline-clip')
      .map((clip) => clip.attributes('data-item-id'));
    const clip = component.find('[data-item-id="clip-1"]');

    expect(renderedClipIds).not.toContain('preview-clip-1');
    expect(clip.attributes('data-is-move-preview')).toBe('false');
    expect(clip.attributes('data-has-slip-preview')).toBe('true');
  });

  it('updates clip presentation props without waiting for a later track rerender', async () => {
    const tracks = [
      {
        id: 'track-1',
        kind: 'video',
        items: [
          {
            id: 'clip-1',
            kind: 'clip',
            showWaveform: true,
            showThumbnails: true,
            audioWaveformMode: 'half',
            timelineRange: { startUs: 0, durationUs: 5_000_000 },
          },
        ],
      },
    ];

    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks,
        trackHeights: { 'track-1': 50 },
      },
    });

    await component.setProps({
      tracks: [
        {
          ...tracks[0],
          items: [
            {
              ...tracks[0]!.items[0],
              showWaveform: false,
              showThumbnails: false,
              audioWaveformMode: 'full',
            },
          ],
        },
      ],
    });

    const clip = component.find('.mock-timeline-clip');
    expect(clip.attributes('data-show-waveform')).toBe('false');
    expect(clip.attributes('data-show-thumbnails')).toBe('false');
    expect(clip.attributes('data-waveform-mode')).toBe('full');
  });

  it('updates clip timeline geometry without waiting for a later track rerender', async () => {
    const tracks = [
      {
        id: 'track-1',
        kind: 'video',
        items: [
          {
            id: 'clip-1',
            kind: 'clip',
            timelineRange: { startUs: 0, durationUs: 5_000_000 },
          },
        ],
      },
    ];

    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks,
        trackHeights: { 'track-1': 50 },
      },
    });

    await component.setProps({
      tracks: [
        {
          ...tracks[0],
          items: [
            {
              ...tracks[0]!.items[0],
              timelineRange: { startUs: 2_000_000, durationUs: 3_000_000 },
            },
          ],
        },
      ],
    });

    const clip = component.find('.mock-timeline-clip');
    expect(clip.attributes('data-start-us')).toBe('2000000');
    expect(clip.attributes('data-duration-us')).toBe('3000000');
  });

  it('updates gap timeline geometry without waiting for a later track rerender', async () => {
    const tracks = [
      {
        id: 'track-1',
        kind: 'video',
        items: [
          {
            id: 'gap-1',
            kind: 'gap',
            timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
          },
        ],
      },
    ];

    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks,
        trackHeights: { 'track-1': 50 },
      },
    });

    await component.setProps({
      tracks: [
        {
          ...tracks[0],
          items: [
            {
              ...tracks[0]!.items[0],
              timelineRange: { startUs: 2_000_000, durationUs: 4_000_000 },
            },
          ],
        },
      ],
    });

    const gap = component.find('.mock-timeline-gap');
    expect(gap.attributes('data-start-us')).toBe('2000000');
    expect(gap.attributes('data-duration-us')).toBe('4000000');
  });

  it('updates clip state props such as locked without waiting for a later track rerender', async () => {
    const tracks = [
      {
        id: 'track-1',
        kind: 'video',
        items: [
          {
            id: 'clip-1',
            kind: 'clip',
            locked: false,
            disabled: false,
            audioMuted: false,
            timelineRange: { startUs: 0, durationUs: 5_000_000 },
          },
        ],
      },
    ];

    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks,
        trackHeights: { 'track-1': 50 },
      },
    });

    await component.setProps({
      tracks: [
        {
          ...tracks[0],
          items: [
            {
              ...tracks[0]!.items[0],
              locked: true,
              disabled: true,
              audioMuted: true,
            },
          ],
        },
      ],
    });

    const clip = component.find('.mock-timeline-clip');
    expect(clip.attributes('data-locked')).toBe('true');
    expect(clip.attributes('data-disabled')).toBe('true');
    expect(clip.attributes('data-audio-muted')).toBe('true');
  });

  it('opens paste parameters modal only if the target track belongs to props.tracks', async () => {
    const docStore = useMockTimelineStore();
    docStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'video',
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              clipType: 'media',
              timelineRange: { startUs: 0, durationUs: 5000000 },
            },
          ],
        },
        {
          id: 'track-2',
          kind: 'audio',
          items: [
            {
              id: 'clip-2',
              kind: 'clip',
              clipType: 'media',
              timelineRange: { startUs: 0, durationUs: 5000000 },
            },
          ],
        },
      ],
    } as any;

    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks: [docStore.timelineDoc.tracks[0]],
      },
    });

    const clipboardStore = useAppClipboard();
    clipboardStore.setClipboardPayload({
      source: 'clipParameters',
      snapshot: {
        trackKind: 'video',
        clipType: 'media',
        groups: {
          transform: {
            transform: {
              position: [0, 0],
            },
          },
        },
      },
    });

    const uiStore = useUiStore();
    uiStore.triggerClipPasteParameters('track-2', 'clip-2');
    await nextTick();
    expect(component.vm.isPasteParametersModalOpen).toBe(false);

    uiStore.triggerClipPasteParameters('track-1', 'clip-1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await nextTick();
    expect(component.vm.isPasteParametersModalOpen).toBe(true);
  });

  it('opens auto montage modal only if at least one item belongs to props.tracks', async () => {
    const uiStore = useUiStore();
    const component = await mountSuspended(TimelineTracks, {
      props: {
        ...defaultProps,
        tracks: [baseTracks[0]],
      },
    });

    uiStore.triggerOpenAutoMontage(['clip-2']);
    await nextTick();
    expect(component.vm.autoMontageModal).toBeNull();

    uiStore.triggerOpenAutoMontage(['clip-1']);
    await nextTick();
    expect(component.vm.autoMontageModal).not.toBeNull();
    expect(component.vm.autoMontageModal?.open).toBe(true);
  });
});
