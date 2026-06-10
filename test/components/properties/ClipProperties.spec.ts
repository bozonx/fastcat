import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref, computed } from 'vue';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import ClipProperties from '~/components/properties/ClipProperties.vue';

mockNuxtImport('useDevice', () => {
  return () => ({ isMobile: false });
});

// Mock subcomponents
vi.mock('~/components/ui/UiRenameModal.vue', () => ({
  default: {
    name: 'UiRenameModal',
    props: ['open', 'currentName', 'title'],
    template: '<div data-testid="rename-modal"></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipAudioSection.vue', () => ({
  default: { name: 'ClipAudioSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipTransitionsSection.vue', () => ({
  default: { name: 'ClipTransitionsSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipActionsSection.vue', () => ({
  default: {
    name: 'ClipActionsSection',
    props: ['commonActions', 'otherActions'],
    template: '<div></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipInfoSection.vue', () => ({
  default: { name: 'ClipInfoSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipBlendingModeSection.vue', () => ({
  default: { name: 'ClipBlendingModeSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipOpacitySection.vue', () => ({
  default: { name: 'ClipOpacitySection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipTransformSection.vue', () => ({
  default: { name: 'ClipTransformSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipTypeSection.vue', () => ({
  default: { name: 'ClipTypeSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipSpeedSection.vue', () => ({
  default: { name: 'ClipSpeedSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipMaskSection.vue', () => ({
  default: { name: 'ClipMaskSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipParametersPasteModal.vue', () => ({
  default: { name: 'ClipParametersPasteModal', template: '<div></div>' },
}));
vi.mock('~/components/effects/ClipEffectsEditor.vue', () => ({
  default: { name: 'ClipEffectsEditor', template: '<div></div>' },
}));

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [{ id: 'track-1', kind: 'video', items: [] }],
  },
  updateClipProperties: vi.fn(),
  updateClipTransition: vi.fn(),
  applyTimeline: vi.fn(),
  batchApplyTimeline: vi.fn(),
  renameItem: vi.fn(),
  copySelectedClips: vi.fn(() => []),
  cutSelectedClips: vi.fn(() => []),
  selectTransition: vi.fn(),
});

const mockProjectStore = reactive({});
const mockProjectTabsStore = reactive({
  setActiveTab: vi.fn(),
});
const mockSelectionStore = reactive({
  selectTimelineTransition: vi.fn(),
});
const mockMediaStore = reactive({
  mediaMetadata: {},
  getCachedMetadata: vi.fn((path: string) => mockMediaStore.mediaMetadata[path]),
});
const mockUiStore = reactive({
  scrollToEffectsTrigger: 0,
  triggerOpenAutoMontage: vi.fn(),
});
const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: {
      defaultTransitionDurationUs: 1_000_000,
    },
  },
});
const mockFocusStore = reactive({});
const mockFileManagerStore = reactive({});
const mockClipboardStore = reactive({
  setClipboardPayload: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/project-tabs.store', () => ({ useProjectTabsStore: () => mockProjectTabsStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/media.store', () => ({ useMediaStore: () => mockMediaStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => mockFocusStore }));
vi.mock('~/stores/file-manager.store', () => ({ useFileManagerStore: () => mockFileManagerStore }));
vi.mock('~/composables/useAppClipboard', () => ({ useAppClipboard: () => mockClipboardStore }));
vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    loadProjectDirectory: vi.fn(),
  }),
}));

// Mock composables for properties
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
    selectedClipTrack: ref({ kind: 'audio' }),
    updateAudioBalance: vi.fn(),
    updateAudioFadeInCurve: vi.fn(),
    updateAudioFadeInSec: vi.fn(),
    updateAudioFadeOutCurve: vi.fn(),
    updateAudioFadeOutSec: vi.fn(),
    updateAudioGain: vi.fn(),
  })),
}));

vi.mock('~/composables/properties/useClipTransitions', () => ({
  useClipTransitions: vi.fn(() => ({
    selectTransitionEdge: vi.fn(),
    toggleTransition: vi.fn(),
    updateTransitionDuration: vi.fn(),
    updateTransitionType: vi.fn(),
  })),
}));

const mockHandleDeleteClip = vi.fn();
vi.mock('~/composables/properties/useClipPropertiesActions', () => ({
  useClipPropertiesActions: vi.fn((options: any) => ({
    handleDeleteClip: mockHandleDeleteClip,
    otherActionsList: ref([]),
    commonActionsList: computed(() => [
      {
        id: 'toggle-disabled',
        label: options.clip.value.disabled ? 'Enable' : 'Disable',
        icon: options.clip.value.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
        color: options.clip.value.disabled ? 'warning' : 'neutral',
        variant: options.clip.value.disabled ? 'solid' : 'ghost',
      },
    ]),
  })),
}));

vi.mock('~/composables/properties/useClipTextProperties', () => ({
  useClipTextProperties: vi.fn(() => ({
    handleUpdateText: vi.fn(),
    handleUpdateTextStyle: vi.fn(),
  })),
}));

vi.mock('~/composables/properties/useClipShapeProperties', () => ({
  useClipShapeProperties: vi.fn(() => ({
    handleUpdateShapeType: vi.fn(),
    handleUpdateFillColor: vi.fn(),
    handleUpdateStrokeColor: vi.fn(),
    handleUpdateStrokeWidth: vi.fn(),
    handleUpdateShapeConfig: vi.fn(),
  })),
}));

vi.mock('~/composables/properties/useClipHudProperties', () => ({
  useClipHudProperties: vi.fn(() => ({
    hudManifest: ref(null),
    hudControlValues: ref({}),
    handleUpdateHudControl: vi.fn(),
  })),
}));

const mockCopyClipParameters = vi.fn();
const mockOpenPasteClipParameters = vi.fn();
const mockApplyClipParameters = vi.fn();
const mockIsPasteParametersModalOpen = ref(false);
const mockSelectedParameterGroups = ref([]);
const mockClipParameterGroupOptions = ref([]);

vi.mock('~/composables/editor/useClipParametersClipboard', () => ({
  useClipParametersClipboard: vi.fn(() => ({
    isPasteParametersModalOpen: mockIsPasteParametersModalOpen,
    selectedParameterGroups: mockSelectedParameterGroups,
    clipParameterGroupOptions: mockClipParameterGroupOptions,
    copyClipParameters: mockCopyClipParameters,
    openPasteClipParameters: mockOpenPasteClipParameters,
    applyClipParameters: mockApplyClipParameters,
  })),
}));

describe('ClipProperties.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.updateClipProperties = vi.fn();
    mockTimelineStore.updateClipTransition = vi.fn();
    mockTimelineStore.applyTimeline = vi.fn();
    mockTimelineStore.batchApplyTimeline = vi.fn();
    mockTimelineStore.renameItem = vi.fn();
    mockTimelineStore.copySelectedClips = vi.fn(() => []);
    mockTimelineStore.cutSelectedClips = vi.fn(() => []);
    mockTimelineStore.selectTransition = vi.fn();
  });

  const createClip = (overrides = {}) => ({
    id: 'clip-1',
    kind: 'clip' as const,
    trackId: 'track-1',
    clipType: 'media' as const,
    name: 'Test Clip',
    timelineRange: { startUs: 1000000, durationUs: 5000000 },
    sourceRange: { startUs: 0, durationUs: 5000000 },
    sourceDurationUs: 10000000,
    source: { path: 'file.mp4' },
    ...overrides,
  });

  async function mountComponent(props = { clip: createClip() }) {
    return await mountSuspended(ClipProperties, {
      props,
      global: {
        stubs: {
          UTabs: {
            props: ['modelValue', 'items'],
            template: `
              <div class="tabs-stub">
                <button v-for="item in items" :key="item.value" :data-tab="item.value" @click="$emit('update:modelValue', item.value)">
                  {{ item.label }}
                </button>
              </div>
            `,
          },
        },
        provide: {
          fileManagerStore: mockFileManagerStore,
        },
      },
    });
  }

  it('renders tabs based on clipType correctly', async () => {
    const clip = createClip({ clipType: 'text' });
    const wrapper = await mountComponent({ clip });

    // For text clipType, tabs should include "text"
    const textTab = wrapper.find('[data-tab="text"]');
    expect(textTab.exists()).toBe(true);

    // Audio tab should not exist for text clips
    const audioTab = wrapper.find('[data-tab="audio"]');
    expect(audioTab.exists()).toBe(false);

    // For media clipType, tabs should include "audio" but not "text"
    const mediaClip = createClip({ clipType: 'media' });
    const mediaWrapper = await mountComponent({ clip: mediaClip });
    expect(mediaWrapper.find('[data-tab="text"]').exists()).toBe(false);
    expect(mediaWrapper.find('[data-tab="audio"]').exists()).toBe(true);
  });

  it('hides audio tab when showAudioTab is false', async () => {
    const clip = createClip({ clipType: 'background' });
    const wrapper = await mountComponent({ clip });

    const audioTab = wrapper.find('[data-tab="audio"]');
    expect(audioTab.exists()).toBe(false);
  });

  it('toggles reversed property when toggleReversed is called', async () => {
    const clip = createClip({ speed: 1 });
    const wrapper = await mountComponent({ clip });

    // Call toggleReversed internally
    wrapper.vm.toggleReversed();

    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      speed: -1,
    });
  });

  it('updates clip properties for start time, end time, and duration correctly', async () => {
    const clip = createClip();
    const wrapper = await mountComponent({ clip });

    wrapper.vm.handleUpdateStartTime(2000000);
    expect(mockTimelineStore.applyTimeline).toHaveBeenCalledWith({
      type: 'move_item',
      trackId: 'track-1',
      itemId: 'clip-1',
      startUs: 2000000,
    });

    wrapper.vm.handleUpdateEndTime(7000000);
    expect(mockTimelineStore.applyTimeline).toHaveBeenCalledWith({
      type: 'trim_item',
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'end',
      deltaUs: 1000000,
    });

    wrapper.vm.handleUpdateDuration(4000000);
    expect(mockTimelineStore.applyTimeline).toHaveBeenCalledWith({
      type: 'trim_item',
      trackId: 'track-1',
      itemId: 'clip-1',
      edge: 'end',
      deltaUs: -1000000,
    });
  });

  it('updates opacity and blendMode correctly', async () => {
    const clip = createClip();
    const wrapper = await mountComponent({ clip });

    wrapper.vm.handleUpdateOpacity(0.5);
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      opacity: 0.5,
    });

    wrapper.vm.handleUpdateBlendMode('multiply');
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      blendMode: 'multiply',
    });
  });

  it('calls clipboard actions copy and cut correctly', async () => {
    mockTimelineStore.copySelectedClips = vi.fn(() => [
      { sourceTrackId: 'track-1', clip: { id: 'clip-1' } as any },
    ]);
    mockTimelineStore.cutSelectedClips = vi.fn(() => [
      { sourceTrackId: 'track-1', clip: { id: 'clip-1' } as any },
    ]);

    const wrapper = await mountComponent();

    wrapper.vm.handleCopyClip();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'copy',
      items: [{ sourceTrackId: 'track-1', clip: { id: 'clip-1' } }],
    });

    wrapper.vm.handleCutClip();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'cut',
      items: [{ sourceTrackId: 'track-1', clip: { id: 'clip-1' } }],
    });
  });

  it('toggles opacityActive, blendModeActive, transformActive, speedActive correctly', async () => {
    const clip = createClip({
      opacityActive: true,
      blendModeActive: true,
      transformActive: true,
      speedActive: true,
    });
    const wrapper = await mountComponent({ clip });

    wrapper.vm.isOpacityEnabled = false;
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      opacityActive: false,
    });

    wrapper.vm.isBlendingEnabled = false;
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      blendModeActive: false,
    });

    wrapper.vm.isTransformEnabled = false;
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      transformActive: false,
    });

    wrapper.vm.isSpeedEnabled = false;
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      speedActive: false,
    });
  });

  it('updates actions reactively when the clip prop is updated', async () => {
    const clip = createClip({ disabled: false });
    const wrapper = await mountComponent({ clip });

    const actionsSection = wrapper.findComponent({ name: 'ClipActionsSection' });
    expect(actionsSection.exists()).toBe(true);

    // Check initial state (disabled = false)
    let commonActions = actionsSection.props('commonActions');
    let toggleDisabledAction = commonActions.find((a: any) => a.id === 'toggle-disabled');
    expect(toggleDisabledAction.label).toBe('Disable');

    // Update the clip prop
    const updatedClip = createClip({ disabled: true });
    await wrapper.setProps({ clip: updatedClip });
    await nextTick();

    // Check updated state (disabled = true)
    commonActions = actionsSection.props('commonActions');
    toggleDisabledAction = commonActions.find((a: any) => a.id === 'toggle-disabled');
    expect(toggleDisabledAction.label).toBe('Enable');
  });
});
