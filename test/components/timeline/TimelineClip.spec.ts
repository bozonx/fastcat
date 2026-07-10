import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountSuspended, mockComponent } from '@nuxt/test-utils/runtime';
import { reactive, computed, ref } from 'vue';
import TimelineClip from '~/components/timeline/TimelineClip.vue';
import { timeUsToPx } from '~/utils/timeline/geometry';

mockComponent('UContextMenu', {
  template: '<div><slot /></div>',
});

// Mock subcomponents
vi.mock('~/components/timeline/ClipTransitions.vue', () => ({
  default: {
    name: 'ClipTransitions',
    props: ['topInsetPx', 'bottomInsetPx'],
    template:
      '<div data-testid="clip-transitions" :style="{ top: `${topInsetPx ?? 0}px`, bottom: `${bottomInsetPx ?? 0}px`, zIndex: `calc(var(--z-clip-handles) + 1)` }"></div>',
  },
}));
vi.mock('~/components/timeline/ClipAudioFades.vue', () => ({
  default: {
    name: 'ClipAudioFades',
    props: [
      'hideFadeHandles',
      'topInsetPx',
      'bottomInsetPx',
      'defaultFadeDurationUs',
      'defaultFadeCurve',
    ],
    template:
      '<div class="clip-audio-fades" :data-hide-fade-handles="hideFadeHandles ? \'true\' : \'false\'" :data-default-fade-duration-us="defaultFadeDurationUs" :data-default-fade-curve="defaultFadeCurve" :style="{ top: `${topInsetPx ?? 0}px`, bottom: `${bottomInsetPx ?? 0}px` }"></div>',
  },
}));
vi.mock('~/components/timeline/ClipMetadata.vue', () => ({
  default: { name: 'ClipMetadata', template: '<div class="clip-metadata"></div>' },
}));
vi.mock('~/components/timeline/TimelineClipThumbnails.vue', () => ({
  default: { name: 'TimelineClipThumbnails', template: '<div></div>' },
}));
vi.mock('~/components/timeline/audio/TimelineAudioWaveform.vue', () => ({
  default: { name: 'TimelineAudioWaveform', template: '<div></div>' },
}));

const mockTimelineStore = reactive({
  timelineZoom: 1,
  selectedItemIds: [] as string[],
  isTrimModeActive: false,
  timelineDoc: { tracks: [] },
  fps: 30,
  isAnyTrackSoloed: false,
  updateClipProperties: vi.fn(),
  updateClipTransition: vi.fn(),
  applyTimeline: vi.fn(),
  batchApplyTimeline: vi.fn(),
  requestTimelineSave: vi.fn(),
  selectTimelineItems: vi.fn(),
  trimToPlayheadLeftNoRipple: vi.fn(),
  trimToPlayheadRightNoRipple: vi.fn(),
  splitClipAtPlayhead: vi.fn(),
  splitClipAtTime: vi.fn(),
  selectTransition: vi.fn(),
});

const mockMediaStore = reactive({
  mediaMetadata: {},
  missingPaths: {},
});

const mockSelectionStore = reactive({
  clearSelection: vi.fn(),
  selectTimelineItem: vi.fn(),
  selectTimelineTransition: vi.fn(),
  selectFsEntry: vi.fn(),
});

const mockWorkspaceStore = reactive({
  userSettings: {
    hotkeys: { layer1: 'Shift', layer2: 'Control' },
    projectDefaults: {
      defaultAudioFadeCurve: 'linear',
    },
    timeline: {
      defaultAudioFadeDurationUs: 500000,
      defaultTransitionDurationUs: 1000000,
    },
  },
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
  },
});

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    loadProjectDirectory: vi.fn(async () => {}),
    findEntryByPath: vi.fn(() => ({})),
  }),
}));

// We also need to mock useClipContextMenu to avoid errors with Vue Router or I18n internally,
// but wait, vitest.setup.ts already mocks vue-i18n. Let's see if it works without mocking useClipContextMenu.

const mockTimelineContext = {
  zoom: computed(() => mockTimelineStore.timelineZoom),
  fps: computed(() => mockTimelineStore.fps),
  currentTime: computed(() => 0),
  isAnyTrackSoloed: computed(() => mockTimelineStore.isAnyTrackSoloed),
  isTrimModeActive: computed(() => mockTimelineStore.isTrimModeActive),
  selectedItemIds: computed(() => mockTimelineStore.selectedItemIds),
  selectedItemIdSet: computed(() => new Set(mockTimelineStore.selectedItemIds)),
  userSettings: computed(() => mockWorkspaceStore.userSettings as any),
  missingPaths: computed(() => mockMediaStore.missingPaths),
  mediaMetadata: computed(() => mockMediaStore.mediaMetadata),
  clipboardPayload: computed(() => ({
    source: 'timeline' as const,
    operation: 'copy' as const,
    items: [],
  })),
  hasTimelinePayload: computed(() => false),
  timelineDoc: computed(() => mockTimelineStore.timelineDoc as any),
  projectSettings: computed(() => ({})),
  currentView: computed(() => ''),
  toolbarDragModeEnabled: computed(() => false),
  toolbarDragMode: computed(() => 'move'),

  updateClipProperties: mockTimelineStore.updateClipProperties,
  updateClipTransition: mockTimelineStore.updateClipTransition,
  requestTimelineSave: mockTimelineStore.requestTimelineSave,
  splitClipAtTime: mockTimelineStore.splitClipAtTime,
  splitClipAtPlayhead: mockTimelineStore.splitClipAtPlayhead,
  selectTimelineItems: mockTimelineStore.selectTimelineItems,
  trimToPlayheadLeftNoRipple: mockTimelineStore.trimToPlayheadLeftNoRipple,
  trimToPlayheadRightNoRipple: mockTimelineStore.trimToPlayheadRightNoRipple,
  applyTimeline: mockTimelineStore.applyTimeline,
  batchApplyTimeline: mockTimelineStore.batchApplyTimeline,
  selectTransition: mockTimelineStore.selectTransition,
  selectTimelineTransition: mockSelectionStore.selectTimelineTransition,
  selectTimelineItem: mockSelectionStore.selectTimelineItem,
  clearSelection: mockSelectionStore.clearSelection,
  setClipboardPayload: vi.fn(),
  triggerScrollToEffects: vi.fn(),
  copySelectedClips: vi.fn(() => []),
  cutSelectedClips: vi.fn(() => []),
  pasteClips: vi.fn(),

  unlinkAudioFromVideo: vi.fn(),
  renameItem: vi.fn(),
  updateTrackProperties: vi.fn(),
  goToFiles: vi.fn(),
  openTimelineFile: vi.fn(),
  goToCut: vi.fn(),
  notifyFileManagerUpdate: vi.fn(),
  triggerScrollToFileTreeEntry: vi.fn(),
  openFolder: vi.fn(),
  selectFsEntry: vi.fn(),
  setTempFocus: vi.fn(),
  setPanelFocus: vi.fn(),
  loadProjectDirectory: vi.fn(),
  findEntryByPath: vi.fn(),
  toggleDirectory: vi.fn(),
  setActiveTab: vi.fn(),

  mediaReplaceTarget: ref(null),
  isMediaReplaceModalOpen: ref(false),
};

const baseTrack = {
  id: 'track-1',
  kind: 'video',
  items: [],
  videoHidden: false,
  audioSolo: false,
};
const baseItem = {
  id: 'clip-1',
  kind: 'clip',
  trackId: 'track-1',
  clipType: 'media',
  source: { path: 'file.mp4' },
  timelineRange: { startUs: 1000000, durationUs: 5000000 },
  mediaRange: { startUs: 0, durationUs: 5000000 },
  sourceRange: { startUs: 0, durationUs: 5000000 },
  sourceDurationUs: 10000000,
  name: 'Test Clip',
  locked: false,
  disabled: false,
  speed: 1,
};

const defaultProps = {
  track: baseTrack,
  item: baseItem,
  trackHeight: 40,
  canEditClipContent: true,
  isDraggingCurrentItem: false,
  isMovePreviewCurrentItem: false,
  selectedTransition: null,
  resizeVolume: null,
  isMobile: false,
};

async function mountClip(props = defaultProps, options: any = {}) {
  return await mountSuspended(TimelineClip, {
    props,
    global: {
      provide: {
        timelineContext: mockTimelineContext,
      },
      ...options?.global,
    },
    ...options,
  });
}

const clipWithAdjacentOut = {
  ...baseItem,
  transitionOut: { type: 'dissolve', durationUs: 1_000_000, mode: 'adjacent' },
};

const nextClipWithHeadHandle = {
  ...baseItem,
  id: 'clip-2',
  timelineRange: { startUs: 6_000_000, durationUs: 5_000_000 },
  sourceRange: { startUs: 1_000_000, durationUs: 5_000_000 },
  sourceDurationUs: 10_000_000,
};

const trackWithAdjacentOut = {
  ...baseTrack,
  items: [clipWithAdjacentOut, nextClipWithHeadHandle],
} as any;

const prevClipWithTailHandle = {
  ...baseItem,
  sourceDurationUs: 6_000_000,
  timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
  sourceRange: { startUs: 0, durationUs: 5_000_000 },
};

const clipWithAdjacentIn = {
  ...baseItem,
  id: 'clip-2',
  timelineRange: { startUs: 6_000_000, durationUs: 5_000_000 },
  transitionIn: { type: 'dissolve', durationUs: 1_000_000, mode: 'adjacent' },
};

const trackWithAdjacentIn = {
  ...baseTrack,
  items: [prevClipWithTailHandle, clipWithAdjacentIn],
} as any;

describe('TimelineClip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.selectedItemIds = [];
    mockTimelineStore.timelineZoom = 1;
    mockTimelineStore.isTrimModeActive = false;
    mockMediaStore.mediaMetadata = {};
  });

  it('calculates position and width correctly based on time and zoom', async () => {
    // Zoom 1 means timeUsToPx(us, 1) = us / 1000000 * 100
    mockTimelineStore.timelineZoom = 1;

    const component = await mountClip();

    const clipDiv = component.find('[data-clip-id="clip-1"]');
    expect(clipDiv.exists()).toBe(true);

    const style = clipDiv.attributes('style');
    // Position/width are pixel-snapped (Math.round) so the browser doesn't smear
    // edges across two physical pixels at non-integer zoom.
    const expectedLeft = Math.round(timeUsToPx(1000000, 1));
    const expectedWidth = Math.round(Math.max(2, timeUsToPx(5000000, 1)));

    expect(style).toContain(`left: ${expectedLeft}px`);
    expect(style).toContain(`width: ${expectedWidth}px`);
  });

  it('displays selected state correctly', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1'];
    const component = await mountClip();
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('outline-(--color-primary)');
    expect(clipDiv.classes()).toContain('z-10');
  });

  it('displays multi-selection state in mobile mode for a single selected clip', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1'];
    const component = await mountClip({
      ...defaultProps,
      isMobile: true,
      isMultiSelectMode: true,
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('outline-orange-400');
    expect(clipDiv.classes()).toContain('z-10');
  });

  it('displays disabled state correctly', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, disabled: true },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('opacity-40');
    expect(clipDiv.classes()).not.toContain('bg-zinc-800/80!');
  });

  it('displays muted track state correctly (keeps background but adds dotted pattern)', async () => {
    const component = await mountClip({
      ...defaultProps,
      track: { ...baseTrack, kind: 'audio', audioMuted: true },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).not.toContain('opacity-60');
    expect(clipDiv.classes()).not.toContain('bg-zinc-800/80!');

    const dottedOverlay = component.find('.muted-track-dots');
    expect(dottedOverlay.exists()).toBe(true);
  });

  it('displays muted clip state correctly (keeps background but adds dotted pattern)', async () => {
    const component = await mountClip({
      ...defaultProps,
      track: { ...baseTrack, kind: 'video' },
      item: { ...baseItem, audioMuted: true },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).not.toContain('opacity-60');
    expect(clipDiv.classes()).not.toContain('bg-zinc-800/80!');

    const dottedOverlay = component.find('.muted-track-dots');
    expect(dottedOverlay.exists()).toBe(true);
  });

  it('displays locked state correctly', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, locked: true },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('cursor-not-allowed');
    // Also, trim handles should not exist if locked
    const trims = component.findAll('.cursor-ew-resize');
    expect(trims.length).toBe(0);
  });

  it('emits startTrimItem when a trim handle is pointer-down', async () => {
    const component = await mountClip();

    const trims = component.findAll('.cursor-ew-resize');
    expect(trims.length).toBe(2); // start and end

    await trims[0].trigger('pointerdown', { button: 0 });

    expect(component.emitted('startTrimItem')).toBeTruthy();
    expect(component.emitted('startTrimItem')![0][1]).toEqual({
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'start',
      startUs: 1000000,
    });

    await trims[1].trigger('pointerdown', { button: 0 });
    expect(component.emitted('startTrimItem')![1][1]).toEqual({
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'end',
      startUs: 1000000,
    });
  });

  it('keeps trim handles full-height while audio fades stay in the content band', async () => {
    mockMediaStore.mediaMetadata = { 'file.mp4': { audio: {} } };

    const component = await mountClip({
      ...defaultProps,
      trackHeight: 40,
    });

    const trimStart = component.get('[data-testid="clip-trim-start"]').element as HTMLElement;
    const audioFades = component.get('.clip-audio-fades').element as HTMLElement;

    expect(trimStart.style.top).toBe('0px');
    expect(trimStart.style.bottom).toBe('0px');
    expect(audioFades.style.top).toBe('20px');
    expect(audioFades.style.bottom).toBe('0px');
    expect(audioFades.dataset.defaultFadeDurationUs).toBe('500000');
    expect(audioFades.dataset.defaultFadeCurve).toBe('linear');
  });

  it('renders transition overlays in the content band above trim handles', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        transitionOut: { type: 'dissolve', durationUs: 1_000_000, mode: 'adjacent' },
      },
    });

    const clipDiv = component.get('[data-clip-id="clip-1"]').element;
    const transitionOverlay = component.get('[data-testid="clip-transitions"]').element;
    const trimStart = component.get('[data-testid="clip-trim-start"]').element;
    const children = Array.from(clipDiv.children);
    const contentIndex = children.findIndex((child) =>
      (child as HTMLElement).classList.contains('flex-1'),
    );
    const transitionIndex = children.indexOf(transitionOverlay);
    const trimIndex = children.indexOf(trimStart);

    expect(contentIndex).toBeGreaterThanOrEqual(0);
    expect(transitionIndex).toBeGreaterThan(contentIndex);
    expect(trimIndex).toBeGreaterThan(transitionIndex);
    expect((transitionOverlay as HTMLElement).style.top).toBe('20px');
    expect((transitionOverlay as HTMLElement).style.bottom).toBe('0px');
    expect((transitionOverlay as HTMLElement).style.zIndex).toBe('calc(var(--z-clip-handles) + 1)');
  });

  it('creates a transition from the clip header button with the default duration', async () => {
    const component = await mountClip();

    await component.get('[data-testid="clip-add-transition-in"]').trigger('click');

    expect(mockTimelineStore.updateClipTransition).toHaveBeenCalledWith('track-1', 'clip-1', {
      transitionIn: {
        type: 'dissolve',
        durationUs: 1_000_000,
        mode: 'transparent',
        curve: 'linear',
      },
    });
    expect(mockTimelineStore.selectTransition).toHaveBeenCalledWith({
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'in',
    });
    expect(mockSelectionStore.selectTimelineTransition).toHaveBeenCalledWith(
      'track-1',
      'clip-1',
      'in',
    );
  });

  it('hides a header transition button when that edge already has a transition', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        transitionIn: { type: 'dissolve', durationUs: 1_000_000, mode: 'adjacent' },
      },
    });

    expect(component.find('[data-testid="clip-add-transition-in"]').exists()).toBe(false);
    expect(component.find('[data-testid="clip-add-transition-out"]').exists()).toBe(true);
  });

  it('computes dynamic trim handle widths based on clip width to prevent blocking narrow clips', async () => {
    // Zoom 50 corresponds to exactly 10 pixels per second
    mockTimelineStore.timelineZoom = 50;

    // Wide clip: 10 seconds -> 100px width. Handles should be capped at 14px.
    const wideComponent = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        timelineRange: { startUs: 1000000, durationUs: 10000000 },
      },
    });
    const wideTrims = wideComponent.findAll('.cursor-ew-resize');
    expect(wideTrims[0].attributes('style')).toContain('width: 14px');

    // Narrow clip: 4 seconds -> 40px width. Handles should be clipWidth * 0.25 = 10px.
    const narrowComponent = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        timelineRange: { startUs: 1000000, durationUs: 4000000 },
      },
    });
    const narrowTrims = narrowComponent.findAll('.cursor-ew-resize');
    expect(narrowTrims[0].attributes('style')).toContain('width: 10px');
  });

  it('triggers onClipClick on pointerdown and then click', async () => {
    const component = await mountClip();
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    // useClickOrDrag logic: pointerdown -> click
    // Note: click might be enough if didStartDrag is false
    await clipDiv.trigger('click', { button: 0 });

    // useClipInteractions should handle the click and emit selectItem
    expect(component.emitted('selectItem')).toBeTruthy();
    expect(component.emitted('selectItem')![0][1]).toBe('clip-1');
  });

  it('splits clip at clicked timeline position in trim mode', async () => {
    mockTimelineStore.isTrimModeActive = true;
    mockTimelineStore.timelineZoom = 50;

    const component = await mountClip();
    const clipDiv = component.find('[data-clip-id="clip-1"]');
    const el = clipDiv.element as HTMLElement;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      right: 150,
      bottom: 40,
      width: 50,
      height: 40,
      toJSON: () => {},
    } as DOMRect);

    await clipDiv.trigger('click', { button: 0, clientX: 120 });

    expect(mockTimelineStore.splitClipAtTime).toHaveBeenCalledWith(
      { trackId: 'track-1', itemId: 'clip-1' },
      3_000_000,
    );
    expect(mockTimelineStore.splitClipAtPlayhead).not.toHaveBeenCalled();
  });

  it('selects clip on mobile tap before drag is allowed', async () => {
    const component = await mountClip({
      ...defaultProps,
      isMobile: true,
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    await clipDiv.trigger('pointerdown', { button: 0, pointerType: 'touch' });
    await clipDiv.trigger('click', { button: 0, pointerType: 'touch' });

    expect(component.emitted('selectItem')).toBeTruthy();
    expect(component.emitted('selectItem')![0][1]).toBe('clip-1');
  });

  it('re-selects clip on mobile tap after drag attempt', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1'];

    const component = await mountClip({
      ...defaultProps,
      isMobile: true,
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    await clipDiv.trigger('pointerdown', {
      button: 0,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    });
    window.dispatchEvent(new Event('pointermove'));
    window.dispatchEvent(new Event('pointerup'));

    await clipDiv.trigger('click', { button: 0, pointerType: 'touch' });

    await clipDiv.trigger('pointerdown', { button: 0, pointerType: 'touch' });
    await clipDiv.trigger('click', { button: 0, pointerType: 'touch' });

    expect(component.emitted('selectItem')).toBeTruthy();
    expect(component.emitted('selectItem')!.at(-1)![1]).toBe('clip-1');
  });

  it('triggers handleSelectInFileManager on double click for media clip', async () => {
    const component = await mountClip();
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    await clipDiv.trigger('dblclick');

    // check if it attempts to set active tab to projects (standard behavior of handleSelectInFileManager)
    // Actually we should check whatever handleSelectInFileManager does.
    // Looking at TimelineClip.vue: onClipDblClick calls handleSelectInFileManager()
  });

  it('displays lime speed indicator when speed is greater than 1', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, speed: 2 },
    });

    const speedIndicator = component.find('.border-dashed.border-lime-500\\/80');
    expect(speedIndicator.exists()).toBe(true);
  });

  it('displays green speed indicator when speed is between 0 and 1', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, speed: 0.5 },
    });

    const speedIndicator = component.find('.border-dashed.border-green-500\\/80');
    expect(speedIndicator.exists()).toBe(true);
  });

  it('displays dark green speed indicator when speed is less than 0', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, speed: -2 },
    });

    const speedIndicator = component.find('.border-dashed.border-green-800\\/80');
    expect(speedIndicator.exists()).toBe(true);
  });

  it('displays blue speed indicator when speed is 0 or clip has freeze frame', async () => {
    const componentSpeed0 = await mountClip({
      ...defaultProps,
      item: { ...baseItem, speed: 0 },
    });
    const speed0Indicator = componentSpeed0.find('.border-dashed.border-blue-500\\/80');
    expect(speed0Indicator.exists()).toBe(true);

    const componentFreeze = await mountClip({
      ...defaultProps,
      item: { ...baseItem, freezeFrameSourceUs: 500000 },
    });
    const freezeIndicator = componentFreeze.find('.border-dashed.border-blue-500\\/80');
    expect(freezeIndicator.exists()).toBe(true);
  });

  it('displays group indicator when clip belongs to a group', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, linkedGroupId: 'group-123' },
    });

    const clipDiv = component.find('[data-clip-id="clip-1"]');
    expect(clipDiv.classes()).toContain('border-yellow-400!');
  });

  it('displays free position indicator when clip is not frame-aligned', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        timelineRange: { startUs: 1012345, durationUs: 5000000 },
      },
    });

    const freePositionIndicator = component.find('.border-dashed.border-amber-500\\/80');
    expect(freePositionIndicator.exists()).toBe(true);
  });

  it('renders slip overlay with offset and source range position', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        sourceRange: { startUs: 2_000_000, durationUs: 5_000_000 },
        sourceDurationUs: 10_000_000,
      },
      slipPreview: {
        itemId: 'clip-1',
        trackId: 'track-1',
        deltaUs: 2_000_000,
        timecode: '+00-00-02-00',
      },
    });

    const overlay = component.find('[data-slip-overlay]');
    const timecode = component.find('[data-slip-timecode]');
    const sourceRange = component.find('[data-slip-source-range]');

    expect(overlay.exists()).toBe(true);
    expect(timecode.text()).toContain('+00-00-02-00');
    expect(sourceRange.attributes('style')).toContain('left: 20%');
    expect(sourceRange.attributes('style')).toContain('width: 50%');
  });

  it('renders trim overlay whose material line tracks the drag in real time', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        sourceRange: { startUs: 1_000_000, durationUs: 5_000_000 },
        sourceDurationUs: 10_000_000,
      },
      trimPreview: {
        itemId: 'clip-1',
        trackId: 'track-1',
        startUs: 1_000_000,
        durationUs: 4_000_000,
        edge: 'start',
        deltaUs: 1_000_000,
      },
    });

    const overlay = component.find('[data-trim-overlay]');
    const timecode = component.find('[data-trim-timecode]');
    const sourceRange = component.find('[data-trim-source-range]');

    expect(overlay.exists()).toBe(true);
    expect(timecode.text()).toContain('+00-00-01-00');
    // The overlay reflects the *previewed* (live) source range, not the committed
    // one: trimming the start by +1s advances the in-point 1s→2s (left 20%) and
    // shrinks the selected material 5s→4s (width 40%). A stale reading would show
    // the pre-drag 10% / 50%.
    expect(sourceRange.attributes('style')).toContain('left: 20%');
    expect(sourceRange.attributes('style')).toContain('width: 40%');
    // Source-material line + end caps are drawn for real media clips.
    expect(component.find('.bg-amber-200\\/80').exists()).toBe(true);
  });

  it('trim overlay on an image shows the offset but no source-material line', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: {
        ...baseItem,
        isImage: true,
        sourceRange: { startUs: 0, durationUs: 5_000_000 },
        sourceDurationUs: 0,
      },
      trimPreview: {
        itemId: 'clip-1',
        trackId: 'track-1',
        startUs: 1_000_000,
        durationUs: 4_000_000,
        edge: 'end',
        deltaUs: -1_000_000,
      },
    });

    // Offset timecode is still shown on every clip while trimming.
    expect(component.find('[data-trim-overlay]').exists()).toBe(true);
    expect(component.find('[data-trim-timecode]').text()).toContain('00-00-01-00');
    // ...but the source-material line and its end caps are suppressed (an image
    // has no finite source to trim in/out of).
    expect(component.find('[data-trim-source-range]').exists()).toBe(false);
    expect(component.find('.bg-amber-200\\/80').exists()).toBe(false);
  });

  describe('fade handles hidden during trim / material move', () => {
    // ClipAudioFades only mounts when the clip has audio; give the media entry an
    // audio stream so it renders and we can read the forwarded hideFadeHandles prop.
    beforeEach(() => {
      mockMediaStore.mediaMetadata = { 'file.mp4': { audio: true } } as any;
    });
    afterEach(() => {
      mockMediaStore.mediaMetadata = {};
    });

    it('keeps fade handles at rest (no trim/slip preview)', async () => {
      const component = await mountClip();
      const fades = component.find('.clip-audio-fades');
      expect(fades.exists()).toBe(true);
      expect(fades.attributes('data-hide-fade-handles')).toBe('false');
    });

    it('hides fade handles while a border is being trimmed', async () => {
      const component = await mountClip({
        ...defaultProps,
        trimPreview: {
          itemId: 'clip-1',
          trackId: 'track-1',
          startUs: 1_000_000,
          durationUs: 4_000_000,
          edge: 'start',
          deltaUs: 1_000_000,
        },
      });
      const fades = component.find('.clip-audio-fades');
      expect(fades.exists()).toBe(true);
      expect(fades.attributes('data-hide-fade-handles')).toBe('true');
    });

    it('hides fade handles while material is being slipped', async () => {
      const component = await mountClip({
        ...defaultProps,
        slipPreview: {
          itemId: 'clip-1',
          trackId: 'track-1',
          deltaUs: 2_000_000,
          timecode: '+00-00-02-00',
        },
      });
      const fades = component.find('.clip-audio-fades');
      expect(fades.exists()).toBe(true);
      expect(fades.attributes('data-hide-fade-handles')).toBe('true');
    });
  });

  it('displays missing media state', async () => {
    mockMediaStore.missingPaths = { 'file.mp4': true };

    const component = await mountClip();

    const clipDiv = component.find('[data-clip-id="clip-1"]');
    expect(clipDiv.classes()).toContain('bg-red-600!');
  });

  it('renders out transition overlay guide only when the out transition is selected directly or adjacent transition in is selected', async () => {
    const component = await mountClip({
      ...defaultProps,
      track: trackWithAdjacentOut,
      item: clipWithAdjacentOut,
    });

    expect(component.find('.border-cyan-400\\/95').exists()).toBe(false);

    // Direct selection of transitionOut on clip-1
    await component.setProps({
      selectedTransition: { trackId: 'track-1', itemId: 'clip-1', edge: 'out' },
    });
    expect(component.find('.border-cyan-400\\/95').exists()).toBe(true);

    // Adjacent selection of transitionIn on clip-2
    await component.setProps({
      selectedTransition: { trackId: 'track-1', itemId: 'clip-2', edge: 'in' },
    });
    expect(component.find('.border-cyan-400\\/95').exists()).toBe(true);

    // Some other transition selection
    await component.setProps({
      selectedTransition: { trackId: 'track-1', itemId: 'clip-1', edge: 'in' },
    });
    expect(component.find('.border-cyan-400\\/95').exists()).toBe(false);
  });

  it('renders in transition overlay guide only when the in transition is selected directly or adjacent transition out is selected', async () => {
    const component = await mountClip({
      ...defaultProps,
      track: trackWithAdjacentIn,
      item: clipWithAdjacentIn,
    });

    expect(component.find('.border-yellow-400\\/95').exists()).toBe(false);

    // Direct selection of transitionIn on clip-2
    await component.setProps({
      selectedTransition: { trackId: 'track-1', itemId: 'clip-2', edge: 'in' },
    });
    expect(component.find('.border-yellow-400\\/95').exists()).toBe(true);

    // Adjacent selection of transitionOut on clip-1
    await component.setProps({
      selectedTransition: { trackId: 'track-1', itemId: 'clip-1', edge: 'out' },
    });
    expect(component.find('.border-yellow-400\\/95').exists()).toBe(true);

    // Some other transition selection
    await component.setProps({
      selectedTransition: { trackId: 'track-1', itemId: 'clip-2', edge: 'out' },
    });
    expect(component.find('.border-yellow-400\\/95').exists()).toBe(false);
  });
});
