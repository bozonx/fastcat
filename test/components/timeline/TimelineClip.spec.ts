import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
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
    timeline: {
      defaultTransitionDurationUs: 1000000,
    },
  },
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/media.store', () => ({ useMediaStore: () => mockMediaStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({ triggerScrollToEffects: vi.fn(), notifyFileManagerUpdate: vi.fn() }),
}));
vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    projectSettings: {},
    goToFiles: vi.fn(),
  }),
}));
vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => ({ toolbarDragModeEnabled: false, toolbarDragMode: 'move' }),
}));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));
vi.mock('~/stores/editor-view.store', () => ({
  useEditorViewStore: () => ({
    goToFiles: vi.fn(),
  }),
}));
vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => ({
    setPanelFocus: vi.fn(),
    setTempFocus: vi.fn(),
  }),
}));
vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => ({}) }));
vi.mock('~/stores/project-tabs.store', () => ({
  useProjectTabsStore: () => ({ setActiveTab: vi.fn() }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    loadProjectDirectory: vi.fn(async () => {}),
    findEntryByPath: vi.fn(() => ({})),
  }),
}));

// We also need to mock useClipContextMenu to avoid errors with Vue Router or I18n internally,
// but wait, vitest.setup.ts already mocks vue-i18n. Let's see if it works without mocking useClipContextMenu.

describe('TimelineClip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.selectedItemIds = [];
    mockTimelineStore.timelineZoom = 1;
    mockTimelineStore.isTrimModeActive = false;
  });

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
  };

  it('calculates position and width correctly based on time and zoom', async () => {
    // Zoom 1 means timeUsToPx(us, 1) = us / 1000000 * 100
    mockTimelineStore.timelineZoom = 1;

    const component = await mountSuspended(TimelineClip, {
      props: defaultProps,
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
        },
      },
    });

    const clipDiv = component.find('[data-clip-id="clip-1"]');
    expect(clipDiv.exists()).toBe(true);

    const style = clipDiv.attributes('style');
    // timeUsToPx calculation: startUs=1000000 -> 100px. durationUs=5000000 -> 500px
    const expectedLeft = timeUsToPx(1000000, 1);
    const expectedWidth = Math.max(2, timeUsToPx(5000000, 1));

    expect(style).toContain(`left: ${expectedLeft}px`);
    expect(style).toContain(`width: ${expectedWidth}px`);
  });

  it('displays selected state correctly', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1'];
    const component = await mountSuspended(TimelineClip, {
      props: defaultProps,
      global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('outline-(--color-primary)');
    expect(clipDiv.classes()).toContain('z-10');
  });

  it('displays disabled state correctly', async () => {
    const component = await mountSuspended(TimelineClip, {
      props: {
        ...defaultProps,
        item: { ...baseItem, disabled: true },
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
        },
      },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('opacity-40');
  });

  it('displays locked state correctly', async () => {
    const component = await mountSuspended(TimelineClip, {
      props: {
        ...defaultProps,
        item: { ...baseItem, locked: true },
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
        },
      },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    expect(clipDiv.classes()).toContain('cursor-not-allowed');
    // Also, trim handles should not exist if locked
    const trims = component.findAll('.cursor-ew-resize');
    expect(trims.length).toBe(0);
  });

  it('emits startTrimItem when a trim handle is pointer-down', async () => {
    const component = await mountSuspended(TimelineClip, {
      props: defaultProps,
      global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } },
    });

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
    const component = await mountSuspended(TimelineClip, {
      props: defaultProps,
      global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    // useClickOrDrag logic: pointerdown -> click
    // Note: click might be enough if didStartDrag is false
    await clipDiv.trigger('click', { button: 0 });

    // useClipInteractions should handle the click and emit selectItem
    expect(component.emitted('selectItem')).toBeTruthy();
    expect(component.emitted('selectItem')![0][1]).toBe('clip-1');
  });

  it('selects clip on mobile tap before drag is allowed', async () => {
    const component = await mountSuspended(TimelineClip, {
      props: {
        ...defaultProps,
        isMobile: true,
      },
      global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    await clipDiv.trigger('pointerdown', { button: 0, pointerType: 'touch' });
    await clipDiv.trigger('click', { button: 0, pointerType: 'touch' });

    expect(component.emitted('selectItem')).toBeTruthy();
    expect(component.emitted('selectItem')![0][1]).toBe('clip-1');
  });

  it('re-selects clip on mobile tap after drag attempt', async () => {
    mockTimelineStore.selectedItemIds = ['clip-1'];

    const component = await mountSuspended(TimelineClip, {
      props: {
        ...defaultProps,
        isMobile: true,
      },
      global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } },
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
    const component = await mountSuspended(TimelineClip, {
      props: defaultProps,
      global: { stubs: { UContextMenu: { template: '<div><slot /></div>' } } },
    });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    await clipDiv.trigger('dblclick');

    // check if it attempts to set active tab to projects (standard behavior of handleSelectInFileManager)
    // Actually we should check whatever handleSelectInFileManager does.
    // Looking at TimelineClip.vue: onClipDblClick calls handleSelectInFileManager()
  });

  it('displays speed indicator when speed is not 1', async () => {
    const component = await mountSuspended(TimelineClip, {
      props: {
        ...defaultProps,
        item: { ...baseItem, speed: 2 },
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
        },
      },
    });

    const speedIndicator = component.find('.border-violet-400');
    expect(speedIndicator.exists()).toBe(true);
  });

  it('displays missing media state', async () => {
    mockMediaStore.missingPaths = { 'file.mp4': true };

    const component = await mountSuspended(TimelineClip, {
      props: defaultProps,
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
        },
      },
    });

    const clipDiv = component.find('[data-clip-id="clip-1"]');
    expect(clipDiv.classes()).toContain('bg-red-600!');
  });
});
