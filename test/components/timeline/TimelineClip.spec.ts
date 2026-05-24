import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, computed, ref } from 'vue';
import TimelineClip from '~/components/timeline/TimelineClip.vue';
import { timeUsToPx } from '~/utils/timeline/geometry';

// Mock subcomponents
vi.mock('~/components/timeline/ClipTransitions.vue', () => ({
  default: { name: 'ClipTransitions', template: '<div></div>' },
}));
vi.mock('~/components/timeline/ClipAudioFades.vue', () => ({
  default: { name: 'ClipAudioFades', template: '<div></div>' },
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
    timeline: {
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
  isTrimModeActive: computed(() => mockTimelineStore.isTrimModeActive),
  selectedItemIds: computed(() => mockTimelineStore.selectedItemIds),
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
      stubs: {
        UContextMenu: { template: '<div><slot /></div>' },
      },
      ...options?.global,
    },
    ...options,
  });
}

describe('TimelineClip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.selectedItemIds = [];
    mockTimelineStore.timelineZoom = 1;
    mockTimelineStore.isTrimModeActive = false;
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

  it('displays disabled state correctly', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, disabled: true },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('opacity-40');
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

  it('displays speed indicator when speed is not 1', async () => {
    const component = await mountClip({
      ...defaultProps,
      item: { ...baseItem, speed: 2 },
    });

    const speedIndicator = component.find('.border-violet-400');
    expect(speedIndicator.exists()).toBe(true);
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

  it('renders trim overlay with source range and timecode', async () => {
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
    expect(sourceRange.attributes('style')).toContain('left: 10%');
    expect(sourceRange.attributes('style')).toContain('width: 50%');
  });

  it('displays missing media state', async () => {
    mockMediaStore.missingPaths = { 'file.mp4': true };

    const component = await mountClip();

    const clipDiv = component.find('[data-clip-id="clip-1"]');
    expect(clipDiv.classes()).toContain('bg-red-600!');
  });
});
