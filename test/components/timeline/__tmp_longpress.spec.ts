import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended, mockComponent } from '@nuxt/test-utils/runtime';
import { reactive, computed, ref } from 'vue';
import TimelineClip from '~/components/timeline/TimelineClip.vue';

mockComponent('UContextMenu', { template: '<div><slot /></div>' });

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

describe('TimelineClip', () => {

describe('TimelineClip long-press (temp)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockTimelineStore.selectedItemIds = [];
    mockTimelineStore.timelineZoom = 1;
    mockTimelineStore.isTrimModeActive = false;
  });

  it('emits clipAction longPress on mobile touch hold', async () => {
    const component = await mountClip({ ...defaultProps, isMobile: true });
    const clipDiv = component.find('[data-clip-id="clip-1"]');

    await clipDiv.trigger('pointerdown', { button: 0, pointerType: 'touch', clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(600);
    await component.vm.$nextTick();

    const ev = component.emitted('clipAction');
    console.log('clipAction emitted:', JSON.stringify(ev));
    expect(ev).toBeTruthy();
  });
});
