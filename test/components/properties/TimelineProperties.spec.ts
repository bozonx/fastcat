import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref, computed } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineProperties from '~/components/properties/TimelineProperties.vue';

vi.stubGlobal('useDevice', () => ({ isMobile: false }));

vi.mock('~/components/ui/UiRenameModal.vue', () => ({
  default: {
    name: 'UiRenameModal',
    props: ['open', 'currentName'],
    template: '<div data-testid="rename-modal"></div>',
  },
}));

vi.mock('~/components/ui/UiEntityCreationModal.vue', () => ({
  default: {
    name: 'UiEntityCreationModal',
    props: ['open', 'title', 'confirmLabel'],
    emits: ['confirm', 'update:open'],
    template: `
      <div data-testid="save-as-modal">
        <button data-testid="save-as-confirm" @click="$emit('confirm', 'NewTimeline')">Confirm</button>
      </div>
    `,
  },
}));

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: { name: 'PropertySection', template: '<section><slot /></section>' },
}));
vi.mock('~/components/properties/PropertyRow.vue', () => ({
  default: { name: 'PropertyRow', props: ['label', 'value'], template: '<div></div>' },
}));
vi.mock('~/components/properties/PropertyActionsBlock.vue', () => ({
  default: {
    name: 'PropertyActionsBlock',
    props: ['quickActions', 'additionalActions'],
    template: '<div data-testid="actions-block"></div>',
  },
}));
vi.mock('~/components/effects/EffectsEditor.vue', () => ({
  default: { name: 'EffectsEditor', template: '<div></div>' },
}));
vi.mock('~/components/effects/AudioEffectsEditor.vue', () => ({
  default: { name: 'AudioEffectsEditor', template: '<div></div>' },
}));
vi.mock('~/components/properties/file/FileGeneralInfoSection.vue', () => ({
  default: { name: 'FileGeneralInfoSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/file/FileTimelineUsageSection.vue', () => ({
  default: { name: 'FileTimelineUsageSection', template: '<div></div>' },
}));
vi.mock('~/components/media/MediaResolutionSettings.vue', () => ({
  default: { name: 'MediaResolutionSettings', template: '<div></div>' },
}));

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [],
    metadata: { fastcat: {} },
  },
  timelineFormat: {
    width: 1920,
    height: 1080,
    fps: 30,
    resolutionFormat: '1080p',
    orientation: 'landscape',
    aspectRatio: '16:9',
    isCustomResolution: false,
    sampleRate: 48000,
  },
  applyTimeline: vi.fn(),
  saveTimelineAs: vi.fn(),
  duplicateCurrentTimeline: vi.fn(),
  loadTimeline: vi.fn(),
  loadTimelineMetadata: vi.fn(),
  addTrack: vi.fn(),
  previewMode: false,
});

const mockProjectStore = reactive({
  currentTimelinePath: 'timelines/main.otio',
  isReadOnly: false,
  openTimelineFile: vi.fn(),
});

const mockUiStore = reactive({
  selectedFsEntry: null,
  notifyFileManagerUpdate: vi.fn(),
  pendingOtioCreateVersion: null,
});

const mockFocusStore = reactive({
  setActiveTimelinePath: vi.fn(),
});

const mockFileManager = reactive({
  vfs: {
    copyFile: vi.fn(),
    getFile: vi.fn(),
    getObjectUrl: vi.fn(),
  },
  loadProjectDirectory: vi.fn(),
  findEntryByPath: vi.fn(),
  toggleDirectory: vi.fn(),
  renameEntry: vi.fn(),
});

const mockSelectionStore = reactive({
  clearSelection: vi.fn(),
});

const mockFileManagerStore = reactive({
  openFolder: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => mockFocusStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/file-manager.store', () => ({ useFileManagerStore: () => mockFileManagerStore }));
vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => ({ mediaMetadata: {}, getCachedMetadata: vi.fn() }),
}));
vi.mock('~/stores/proxy.store', () => ({ useProxyStore: () => ({ existingProxies: new Map() }) }));
vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => ({}),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

vi.mock('~/composables/file-manager/useEntryPreview', () => ({
  useEntryPreview: () => ({
    timelineDocSummary: ref(null),
    fileInfo: ref(null),
    mediaType: ref('otio'),
    textContent: ref(null),
  }),
}));

vi.mock('~/composables/properties/useFilePropertiesBasics', () => ({
  useFilePropertiesBasics: () => ({
    generalInfoTitle: ref(''),
    isHidden: ref(false),
    selectedPath: ref(''),
  }),
}));

vi.mock('~/composables/properties/useFilePropertiesHandlers', () => ({
  useFilePropertiesHandlers: () => ({
    onDelete: vi.fn(),
  }),
}));

vi.mock('~/composables/properties/useFileTimelineUsage', () => ({
  useFileTimelineUsage: () => ({
    timelinesUsingSelectedFile: ref([]),
    openTimelineFromUsage: vi.fn(),
  }),
}));

vi.mock('~/composables/file-manager/revealFileManagerEntry', () => ({
  revealFileManagerEntry: vi.fn(),
}));

vi.mock('~/stores/project-tabs.store', () => ({
  useProjectTabsStore: () => ({ setActiveTab: vi.fn() }),
}));

describe('TimelineProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.currentTimelinePath = 'timelines/main.otio';
    mockProjectStore.isReadOnly = false;
    mockTimelineStore.previewMode = false;
  });

  it('renders save-as action in additional actions when fsEntry is present', async () => {
    const wrapper = await mountSuspended(TimelineProperties, {
      props: {
        fsEntry: {
          kind: 'file',
          name: 'main.otio',
          path: 'timelines/main.otio',
          parentPath: 'timelines',
          lastModified: Date.now(),
          size: 100,
          source: 'project',
        },
      },
    });

    const actionsBlock = wrapper.find('[data-testid="actions-block"]');
    expect(actionsBlock.exists()).toBe(true);

    const additionalActions = (wrapper.vm as any).timelineAdditionalActions;
    const saveAsAction = additionalActions.find((a: any) => a.id === 'saveTimelineAs');
    expect(saveAsAction).toBeDefined();
    expect(saveAsAction.label).toBeDefined();
    expect(saveAsAction.icon).toBeDefined();
  });

  it('opens save-as modal when save-as action is clicked', async () => {
    const wrapper = await mountSuspended(TimelineProperties, {
      props: {
        fsEntry: {
          kind: 'file',
          name: 'main.otio',
          path: 'timelines/main.otio',
          parentPath: 'timelines',
          lastModified: Date.now(),
          size: 100,
          source: 'project',
        },
      },
    });

    expect((wrapper.vm as any).isSaveAsModalOpen).toBe(false);

    const saveAsAction = (wrapper.vm as any).timelineAdditionalActions.find(
      (a: any) => a.id === 'saveTimelineAs',
    );
    saveAsAction.onClick();

    expect((wrapper.vm as any).isSaveAsModalOpen).toBe(true);
  });

  it('calls timelineStore.saveTimelineAs for active timeline on save-as confirm', async () => {
    const wrapper = await mountSuspended(TimelineProperties, {
      props: {
        fsEntry: {
          kind: 'file',
          name: 'main.otio',
          path: 'timelines/main.otio',
          parentPath: 'timelines',
          lastModified: Date.now(),
          size: 100,
          source: 'project',
        },
      },
    });

    await (wrapper.vm as any).handleSaveAsConfirm('copy.otio');

    expect(mockTimelineStore.saveTimelineAs).toHaveBeenCalledWith('copy.otio');
  });

  it('copies file via VFS for inactive timeline on save-as confirm', async () => {
    mockProjectStore.currentTimelinePath = 'timelines/other.otio';

    const wrapper = await mountSuspended(TimelineProperties, {
      props: {
        fsEntry: {
          kind: 'file',
          name: 'main.otio',
          path: 'timelines/main.otio',
          parentPath: 'timelines',
          lastModified: Date.now(),
          size: 100,
          source: 'project',
        },
      },
    });

    await (wrapper.vm as any).handleSaveAsConfirm('inactive_copy');

    expect(mockFileManager.vfs.copyFile).toHaveBeenCalledWith(
      'timelines/main.otio',
      'timelines/inactive_copy.otio',
    );
    expect(mockProjectStore.openTimelineFile).toHaveBeenCalledWith('timelines/inactive_copy.otio');
    expect(mockFocusStore.setActiveTimelinePath).toHaveBeenCalledWith(
      'timelines/inactive_copy.otio',
    );
  });
});
