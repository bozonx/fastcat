import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { TICKS_PER_SECOND } from '~/utils/time';
import MultiClipProperties from '~/components/properties/MultiClipProperties.vue';

// Mock subcomponents
vi.mock('~/components/properties/clip/ClipTransitionsSection.vue', () => ({
  default: {
    name: 'ClipTransitionsSection',
    template: '<div data-testid="transitions-section"></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipTransformSection.vue', () => ({
  default: {
    name: 'ClipTransformSection',
    template: '<div data-testid="transform-section"></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipAudioSection.vue', () => ({
  default: { name: 'ClipAudioSection', template: '<div data-testid="audio-section"></div>' },
}));
vi.mock('~/components/properties/multi-clip/MultiClipActionsSection.vue', () => ({
  default: {
    name: 'MultiClipActionsSection',
    props: ['selectedCountLabel', 'isMobile'],
    template: '<div data-testid="actions-section">{{ selectedCountLabel }}</div>',
  },
}));
vi.mock('~/components/properties/multi-clip/MultiClipBlendOpacitySection.vue', () => ({
  default: {
    name: 'MultiClipBlendOpacitySection',
    template: '<div data-testid="blend-opacity-section"></div>',
  },
}));
vi.mock('~/components/properties/multi-clip/MultiClipTimingSection.vue', () => ({
  default: {
    name: 'MultiClipTimingSection',
    props: ['hideUniformDuration', 'isMobile'],
    template: '<div data-testid="timing-section"></div>',
  },
}));

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        kind: 'video',
        items: [
          {
            id: 'clip-1',
            kind: 'clip',
            clipType: 'media',
            timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
          },
          {
            id: 'clip-2',
            kind: 'clip',
            clipType: 'media',
            timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
          },
        ],
      },
    ],
  },
  updateClipProperties: vi.fn(),
  updateClipTransition: vi.fn(),
  applyTimeline: vi.fn(),
  batchApplyTimeline: vi.fn(),
  renameItem: vi.fn(),
  copySelectedClips: vi.fn(() => []),
  cutSelectedClips: vi.fn(() => []),
  selectTransition: vi.fn(),
  clearSelection: vi.fn(),
  isMobileLayout: false,
});

const mockSelectionStore = reactive({
  selectTimelineTransition: vi.fn(),
});
const mockMediaStore = reactive({
  mediaMetadata: {
    'file.mp4': { audio: true },
  },
  getCachedMetadata: vi.fn((path: string) => mockMediaStore.mediaMetadata[path]),
});
const mockUiStore = reactive({
  triggerOpenAutoMontage: vi.fn(),
});
const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: {
      defaultTransitionDurationUs: TICKS_PER_SECOND,
    },
  },
});
const mockClipboardStore = reactive({
  setClipboardPayload: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/media.store', () => ({ useMediaStore: () => mockMediaStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));
vi.mock('~/composables/useAppClipboard', () => ({ useAppClipboard: () => mockClipboardStore }));

// Mock Batch Actions composable
const mockClipBatchActions = {
  selectedClips: ref([] as any[]),
  hasLockedLinks: ref(false),
  hasGroupedClip: ref(false),
  isSingleGroupSelection: ref(false),
  hasFreeClip: ref(false),
  allDisabled: ref(false),
  allMuted: ref(false),
  allLocked: ref(false),
  isWaveformShown: ref(false),
  isWaveformFull: ref(false),
  isThumbnailsShown: ref(false),
  hasAudioOrVideoWithAudio: ref(false),
  hasVideo: ref(false),
  hasVisual: ref(false),
  hasSpeedControls: ref(false),
  hasSourceOrientationControls: ref(false),
  hasAutoMontageControls: ref(false),
  firstVideoClip: ref(null as any),
  firstWaveformClip: ref(null as any),
  firstSpeedClip: ref(null as any),
  firstSourceOrientationClip: ref(null as any),
  audioClipRefs: ref([] as any[]),
  waveformClipRefs: ref([] as any[]),
  thumbnailClipRefs: ref([] as any[]),
  visualClipRefs: ref([] as any[]),
  speedClipRefs: ref([] as any[]),
  sourceOrientationClipRefs: ref([] as any[]),
  autoMontageClipRefs: ref([] as any[]),
  handleUnlinkSelected: vi.fn(),
  handleGroupSelected: vi.fn(),
  handleUngroupSelected: vi.fn(),
  handleDelete: vi.fn(),
  toggleDisabled: vi.fn(),
  toggleMuted: vi.fn(),
  toggleLocked: vi.fn(),
  toggleShowWaveform: vi.fn(),
  toggleWaveformMode: vi.fn(),
  toggleShowThumbnails: vi.fn(),
  handleSetUniformDuration: vi.fn(),
  handleRelativeStartShift: vi.fn(),
  handleRelativeEndShift: vi.fn(),
  handleBatchUpdateProperties: vi.fn(),
};

vi.mock('~/composables/timeline/useClipBatchActions', () => ({
  useClipBatchActions: vi.fn(() => mockClipBatchActions),
}));

vi.mock('~/composables/properties/useClipAudio', () => ({
  useClipAudio: vi.fn(() => ({
    audioBalance: ref(0),
    audioFadeInCurve: ref('linear'),
    audioFadeInMaxSec: ref(5),
    audioFadeInSec: ref(0),
    audioFadeOutCurve: ref('linear'),
    audioFadeOutMaxSec: ref(5),
    audioFadeOutSec: ref(0),
    audioGain: ref(1),
    canEditAudioBalance: ref(true),
    canEditAudioFades: ref(true),
    canEditAudioGain: ref(true),
    updateAudioBalance: vi.fn(),
    updateAudioFadeInCurve: vi.fn(),
    updateAudioFadeInSec: vi.fn(),
    updateAudioFadeOutCurve: vi.fn(),
    updateAudioFadeOutSec: vi.fn(),
    updateAudioGain: vi.fn(),
  })),
}));

describe('MultiClipProperties.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.batchApplyTimeline = vi.fn();
    mockClipboardStore.setClipboardPayload = vi.fn();
    mockTimelineStore.copySelectedClips = vi.fn(() => []);
    mockTimelineStore.cutSelectedClips = vi.fn(() => []);
    mockTimelineStore.isMobileLayout = false;

    // Reset batch actions defaults
    mockClipBatchActions.selectedClips.value = [];
    mockClipBatchActions.hasVisual.value = false;
    mockClipBatchActions.hasSpeedControls.value = false;
    mockClipBatchActions.hasSourceOrientationControls.value = false;
    mockClipBatchActions.hasAutoMontageControls.value = false;
    mockClipBatchActions.firstVideoClip.value = null;
    mockClipBatchActions.firstWaveformClip.value = null;
    mockClipBatchActions.firstSpeedClip.value = null;
    mockClipBatchActions.firstSourceOrientationClip.value = null;
    mockClipBatchActions.audioClipRefs.value = [];
    mockClipBatchActions.waveformClipRefs.value = [];
    mockClipBatchActions.thumbnailClipRefs.value = [];
    mockClipBatchActions.visualClipRefs.value = [];
    mockClipBatchActions.speedClipRefs.value = [];
    mockClipBatchActions.sourceOrientationClipRefs.value = [];
    mockClipBatchActions.autoMontageClipRefs.value = [];
  });

  const defaultProps = {
    items: [
      { trackId: 'track-1', itemId: 'clip-1' },
      { trackId: 'track-1', itemId: 'clip-2' },
    ],
  };

  async function mountComponent(props = defaultProps) {
    if (
      mockClipBatchActions.firstVideoClip.value &&
      mockClipBatchActions.visualClipRefs.value.length === 0
    ) {
      mockClipBatchActions.hasVisual.value = true;
      const track = mockTimelineStore.timelineDoc.tracks[0];
      mockClipBatchActions.visualClipRefs.value = track.items.map((clip: any) => ({ track, clip }));
    }
    return await mountSuspended(MultiClipProperties, {
      props,
    });
  }

  it('renders selected clips count label correctly', async () => {
    const wrapper = await mountComponent();
    expect(wrapper.find('[data-testid="actions-section"]').text()).toContain(
      'fastcat.timeline.selectedClipsCount',
    );
  });

  it('renders group label when selection is a single linked group', async () => {
    mockClipBatchActions.isSingleGroupSelection.value = true;
    const wrapper = await mountComponent();
    expect(wrapper.find('[data-testid="actions-section"]').text()).toContain(
      'fastcat.timeline.groupSelectedClipsCount',
    );
  });

  it('hides group button when all selected clips already form a single group', async () => {
    mockClipBatchActions.isSingleGroupSelection.value = true;
    const wrapper = await mountComponent();
    const otherActions = (wrapper.vm as any).otherActions as Array<{
      id: string;
      hidden?: boolean;
    }>;
    const groupAction = otherActions.find((a) => a.id === 'group');
    expect(groupAction?.hidden).toBe(true);
  });

  it('passes hideUniformDuration to timing section for single group selection', async () => {
    mockClipBatchActions.isSingleGroupSelection.value = true;
    const wrapper = await mountComponent();
    const timingSection = wrapper.findComponent({ name: 'MultiClipTimingSection' });
    expect(timingSection.props('hideUniformDuration')).toBe(true);
  });

  it('passes isMobile=false to timing section when timeline is not in mobile layout', async () => {
    mockTimelineStore.isMobileLayout = false;
    const wrapper = await mountComponent();
    const timingSection = wrapper.findComponent({ name: 'MultiClipTimingSection' });
    expect(timingSection.props('isMobile')).toBe(false);
  });

  it('passes isMobile=true to timing section when timeline is in mobile layout', async () => {
    mockTimelineStore.isMobileLayout = true;
    const wrapper = await mountComponent();
    const timingSection = wrapper.findComponent({ name: 'MultiClipTimingSection' });
    expect(timingSection.props('isMobile')).toBe(true);
  });

  it('displays sub-panels depending on flags', async () => {
    const wrapper = await mountComponent();
    expect(wrapper.find('[data-testid="transitions-section"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="blend-opacity-section"]').exists()).toBe(false);

    // Set video or image selection active
    mockClipBatchActions.hasVisual.value = true;
    mockClipBatchActions.firstVideoClip.value = {
      id: 'clip-1',
      trackId: 'track-1',
      clipType: 'media',
      timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
    };
    mockClipBatchActions.visualClipRefs.value = [
      { track: { id: 'track-1', kind: 'video' }, clip: mockClipBatchActions.firstVideoClip.value },
    ];
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="transitions-section"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="blend-opacity-section"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="transform-section"]').exists()).toBe(true);
  });

  it('copies and cuts clips correctly', async () => {
    mockTimelineStore.copySelectedClips = vi.fn(() => [
      { sourceTrackId: 'track-1', clip: { id: 'clip-1' } as any },
    ]);
    mockTimelineStore.cutSelectedClips = vi.fn(() => [
      { sourceTrackId: 'track-1', clip: { id: 'clip-1' } as any },
    ]);

    const wrapper = await mountComponent();

    wrapper.vm.handleCopyClips();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'copy',
      items: [{ sourceTrackId: 'track-1', clip: { id: 'clip-1' } }],
    });

    wrapper.vm.handleCutClips();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'cut',
      items: [{ sourceTrackId: 'track-1', clip: { id: 'clip-1' } }],
    });
  });

  it('updates start and duration relative shifts correctly', async () => {
    const wrapper = await mountComponent();

    wrapper.vm.onStartShiftChange(500000);
    expect(mockClipBatchActions.handleRelativeStartShift).toHaveBeenCalledWith(500000);

    wrapper.vm.onDurationShiftChange(400000);
    expect(mockClipBatchActions.handleRelativeEndShift).toHaveBeenCalledWith(400000);
  });

  it('batch updates transition duration and type correctly', async () => {
    mockClipBatchActions.firstVideoClip.value = {
      id: 'clip-1',
      trackId: 'track-1',
      clipType: 'media',
      timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
    };
    mockClipBatchActions.selectedClips.value = [
      {
        id: 'clip-1',
        trackId: 'track-1',
        kind: 'clip',
        timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
        transitionIn: { type: 'dissolve', durationUs: TICKS_PER_SECOND },
      },
      {
        id: 'clip-2',
        trackId: 'track-1',
        kind: 'clip',
        timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
        transitionIn: { type: 'dissolve', durationUs: TICKS_PER_SECOND },
      },
    ];
    mockTimelineStore.timelineDoc.tracks[0].items = [
      {
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
        transitionIn: { type: 'dissolve', durationUs: TICKS_PER_SECOND },
      } as any,
      {
        id: 'clip-2',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
        transitionIn: { type: 'dissolve', durationUs: TICKS_PER_SECOND },
      } as any,
    ];

    const wrapper = await mountComponent();

    wrapper.vm.handleBatchUpdateTransitionDuration('in', 2);
    expect(mockTimelineStore.batchApplyTimeline).toHaveBeenCalledWith([
      {
        type: 'update_clip_transition',
        trackId: 'track-1',
        itemId: 'clip-1',
        transitionIn: { type: 'dissolve', durationUs: 2 * TICKS_PER_SECOND },
      },
      {
        type: 'update_clip_transition',
        trackId: 'track-1',
        itemId: 'clip-2',
        transitionIn: { type: 'dissolve', durationUs: 2 * TICKS_PER_SECOND },
      },
    ]);

    wrapper.vm.handleBatchUpdateTransitionType('in', 'wipe');
    expect(mockTimelineStore.batchApplyTimeline).toHaveBeenCalledWith([
      {
        type: 'update_clip_transition',
        trackId: 'track-1',
        itemId: 'clip-1',
        transitionIn: { type: 'wipe', durationUs: TICKS_PER_SECOND },
      },
      {
        type: 'update_clip_transition',
        trackId: 'track-1',
        itemId: 'clip-2',
        transitionIn: { type: 'wipe', durationUs: TICKS_PER_SECOND },
      },
    ]);
  });

  it('toggles transition correctly in batch', async () => {
    mockClipBatchActions.firstVideoClip.value = {
      id: 'clip-1',
      trackId: 'track-1',
      clipType: 'media',
      timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
      transitionIn: { type: 'dissolve', durationUs: TICKS_PER_SECOND },
    };
    mockTimelineStore.timelineDoc.tracks[0].items = [
      {
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
        transitionIn: { type: 'dissolve', durationUs: TICKS_PER_SECOND },
      } as any,
      {
        id: 'clip-2',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
        transitionIn: { type: 'dissolve', durationUs: TICKS_PER_SECOND },
      } as any,
    ];

    const wrapper = await mountComponent();

    // With transitionIn present, calling toggle transitionIn should remove it (set to null)
    wrapper.vm.handleBatchToggleTransition('in');
    expect(mockTimelineStore.batchApplyTimeline).toHaveBeenCalledWith([
      { type: 'update_clip_transition', trackId: 'track-1', itemId: 'clip-1', transitionIn: null },
      { type: 'update_clip_transition', trackId: 'track-1', itemId: 'clip-2', transitionIn: null },
    ]);
  });

  it('passes isMobile=false to MultiClipActionsSection by default', async () => {
    const wrapper = await mountComponent();
    const actionsSection = wrapper.findComponent({ name: 'MultiClipActionsSection' });
    expect(actionsSection.props('isMobile')).toBe(false);
  });

  it('batch updates transform property with computed delta scale and rotation', async () => {
    mockClipBatchActions.firstVideoClip.value = {
      id: 'clip-1',
      trackId: 'track-1',
      clipType: 'media',
      timelineRange: { durationUs: 5 * TICKS_PER_SECOND },
      transform: {
        scale: { x: 1, y: 1, linked: true },
        rotationDeg: 0,
        position: { x: 0, y: 0 },
        crop: { top: 0, bottom: 0, left: 0, right: 0 },
      },
    };

    mockTimelineStore.timelineDoc.tracks[0].items = [
      {
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        transform: {
          scale: { x: 1, y: 1, linked: true },
          rotationDeg: 0,
          position: { x: 0, y: 0 },
          crop: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      } as any,
      {
        id: 'clip-2',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        transform: {
          scale: { x: 2, y: 2, linked: true },
          rotationDeg: 10,
          position: { x: 5, y: 5 },
          crop: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      } as any,
    ];

    const wrapper = await mountComponent();

    // Call batch transform with new values (scale by +0.5, rotate by +5)
    wrapper.vm.handleBatchTransform({
      scale: { x: 1.5, y: 1.5, linked: true },
      rotationDeg: 5,
      position: { x: 10, y: 10 },
      crop: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    expect(mockTimelineStore.batchApplyTimeline).toHaveBeenCalledWith([
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-1',
        properties: {
          transform: {
            scale: { x: 1.5, y: 1.5, linked: true },
            rotationDeg: 5,
            position: { x: 10, y: 10 },
            crop: { top: 0, bottom: 0, left: 0, right: 0 },
          },
        },
      },
      {
        type: 'update_clip_properties',
        trackId: 'track-1',
        itemId: 'clip-2',
        properties: {
          transform: {
            scale: { x: 2.5, y: 2.5, linked: true },
            rotationDeg: 15,
            position: { x: 15, y: 15 },
            crop: { top: 0, bottom: 0, left: 0, right: 0 },
          },
        },
      },
    ]);
  });
});
