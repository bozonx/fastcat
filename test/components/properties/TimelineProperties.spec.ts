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
vi.mock('~/components/effects/ClipEffectsEditor.vue', () => ({
  default: { name: 'ClipEffectsEditor', props: ['target'], template: '<div></div>' },
}));
vi.mock('~/components/properties/file/FileGeneralInfoSection.vue', () => ({
  default: { name: 'FileGeneralInfoSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/file/FileTimelineUsageSection.vue', () => ({
  default: { name: 'FileTimelineUsageSection', template: '<div></div>' },
}));
vi.mock('~/components/media/MediaResolutionSettings.vue', () => ({
  default: {
    name: 'MediaResolutionSettings',
    props: ['disabled', 'standardFpsOnly'],
    template: '<div data-testid="media-resolution-settings"></div>',
  },
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
    isAutoSettings: false,
    geometryResolved: true,
    sampleRateResolved: true,
    settingsSource: 'manual',
    useProjectSettings: false,
  },
  masterGain: 1,
  applyTimeline: vi.fn(),
  updateTimelineFormat: vi.fn(),
  saveTimelineAs: vi.fn(),
  duplicateCurrentTimeline: vi.fn(),
  loadTimeline: vi.fn(),
  loadTimelineMetadata: vi.fn(),
  addTrack: vi.fn(),
  setAudioVolume: vi.fn(),
  previewMode: false,
});

const mockProjectStore = reactive({
  currentTimelinePath: 'timelines/main.otio',
  isReadOnly: false,
  projectSettings: {
    project: {
      width: 1280,
      height: 720,
      fps: 25,
      resolutionFormat: '720p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
      sampleRate: 44100,
      isAutoSettings: false,
      geometryResolved: true,
      sampleRateResolved: true,
    },
  },
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

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: computed(() => true),
  userSettings: { presets: {} },
});

vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

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
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = computed(() => true);
    mockProjectStore.currentTimelinePath = 'timelines/main.otio';
    mockProjectStore.isReadOnly = false;
    mockTimelineStore.previewMode = false;
    mockTimelineStore.masterGain = 1;
    mockTimelineStore.updateTimelineFormat.mockClear();
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

  it('shows and edits master volume as percent while storing gain', async () => {
    mockTimelineStore.masterGain = 1.76;

    const wrapper = await mountSuspended(TimelineProperties);

    const volumeSlider = wrapper.findComponent({ name: 'UiSliderInput' });

    expect(volumeSlider.props('modelValue')).toBe(176);
    expect(volumeSlider.props('max')).toBe(200);
    expect(volumeSlider.props('unit')).toBe('%');
    expect(volumeSlider.props('showInputUnit')).toBe(true);

    await volumeSlider.vm.$emit('update:modelValue', 150);

    expect(mockTimelineStore.setAudioVolume).toHaveBeenCalledWith(1.5);
  });

  it('keeps timeline format controls editable and resets from project defaults', async () => {
    const wrapper = await mountSuspended(TimelineProperties);

    const resolutionSettings = wrapper.findComponent({ name: 'MediaResolutionSettings' });
    expect(resolutionSettings.props('disabled')).toBeUndefined();
    expect(resolutionSettings.props('standardFpsOnly')).toBe(true);

    await (wrapper.vm as any).resetTimelineFormatToProjectDefaults();

    expect(mockTimelineStore.updateTimelineFormat).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1280,
        height: 720,
        fps: 25,
        sampleRate: 44100,
        settingsSource: 'projectDefaults',
        useProjectSettings: false,
        isAutoSettings: false,
        geometryResolved: true,
        sampleRateResolved: true,
      }),
    );
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

  it('hides the master audio effects editor when in-development features are disabled', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = computed(() => false);
    mockTimelineStore.timelineDoc.metadata.fastcat.masterEffects = [
      { target: 'audio', type: 'test' } as any,
    ];

    const wrapper = await mountSuspended(TimelineProperties);

    const audioEffectsEditor = wrapper
      .findAllComponents({ name: 'ClipEffectsEditor' })
      .find((c) => c.props('target') === 'audio');
    expect(audioEffectsEditor).toBeUndefined();
  });
});
