import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref, computed, nextTick } from 'vue';
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
vi.mock('~/components/properties/clip/ClipBackgroundProperties.vue', () => ({
  default: { name: 'ClipBackgroundProperties', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipTransitionsSection.vue', () => ({
  default: { name: 'ClipTransitionsSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipActionsSection.vue', () => ({
  default: {
    name: 'ClipActionsSection',
    props: ['commonActions', 'otherActions'],
    emits: ['copy', 'cut', 'copy-parameters', 'paste-parameters', 'rename'],
    template: '<div></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipInfoSection.vue', () => ({
  default: {
    name: 'ClipInfoSection',
    emits: ['update-start-time', 'update-end-time'],
    template: '<div></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipBlendingModeSection.vue', () => ({
  default: {
    name: 'ClipBlendingModeSection',
    emits: ['update:enabled', 'update-blend-mode'],
    template: '<div></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipOpacitySection.vue', () => ({
  default: {
    name: 'ClipOpacitySection',
    emits: ['update:enabled', 'update-opacity'],
    template: '<div></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipTransformSection.vue', () => ({
  default: {
    name: 'ClipTransformSection',
    emits: ['update:enabled', 'update-transform', 'toggle-reversed'],
    template: '<div></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipTypeSection.vue', () => ({
  default: { name: 'ClipTypeSection', template: '<div></div>' },
}));
vi.mock('~/components/properties/clip/ClipMaskSection.vue', () => ({
  default: {
    name: 'ClipMaskSection',
    emits: ['update:enabled'],
    template: '<div></div>',
  },
}));
vi.mock('~/components/properties/clip/ClipParametersPasteModal.vue', () => ({
  default: { name: 'ClipParametersPasteModal', template: '<div></div>' },
}));
vi.mock('~/components/effects/ClipEffectsEditor.vue', () => ({
  default: {
    name: 'ClipEffectsEditor',
    props: ['target', 'effects', 'hasToggle', 'disabled'],
    emits: ['update:effects', 'update:enabled'],
    template: '<div :data-testid="`clip-effects-${target}`"></div>',
  },
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
  inDevelopmentFeaturesEnabled: false,
  isFeatureEnabled: vi.fn(() => false),
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
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    mockTimelineStore.updateClipProperties = vi.fn();
    mockTimelineStore.updateClipTransition = vi.fn();
    mockTimelineStore.applyTimeline = vi.fn();
    mockTimelineStore.batchApplyTimeline = vi.fn();
    mockTimelineStore.renameItem = vi.fn();
    mockTimelineStore.copySelectedClips = vi.fn(() => []);
    mockTimelineStore.cutSelectedClips = vi.fn(() => []);
    mockTimelineStore.selectTransition = vi.fn();
    mockTimelineStore.timelineDoc.tracks = [{ id: 'track-1', kind: 'video', items: [] }];
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

  it('toggles reversed property when toggle-reversed event is emitted', async () => {
    const clip = createClip({ speed: 1 });
    const wrapper = await mountComponent({ clip });

    // Switch to video tab where ClipTransformSection is rendered
    await wrapper.find('[data-tab="video"]').trigger('click');
    await nextTick();

    const transformSection = wrapper.findComponent({ name: 'ClipTransformSection' });
    expect(transformSection.exists()).toBe(true);
    transformSection.vm.$emit('toggle-reversed');
    await nextTick();

    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      speed: -1,
    });
  });

  it('enables transform group when transform section updates transform', async () => {
    const clip = createClip({ transformActive: false });
    const wrapper = await mountComponent({ clip });

    await wrapper.find('[data-tab="video"]').trigger('click');
    await nextTick();

    const transformSection = wrapper.findComponent({ name: 'ClipTransformSection' });
    expect(transformSection.exists()).toBe(true);

    const transform = {
      scale: { x: 1, y: 1, linked: true },
      flipHorizontal: true,
      flipVertical: false,
    };
    transformSection.vm.$emit('update-transform', transform);
    await nextTick();

    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      transform,
      transformActive: true,
    });
  });

  it('updates clip properties for start time and end time correctly', async () => {
    const clip = createClip();
    const wrapper = await mountComponent({ clip });

    const infoSection = wrapper.findComponent({ name: 'ClipInfoSection' });
    expect(infoSection.exists()).toBe(true);

    infoSection.vm.$emit('update-start-time', 2000000);
    await nextTick();
    expect(mockTimelineStore.applyTimeline).toHaveBeenCalledWith(
      {
        type: 'move_item',
        trackId: 'track-1',
        itemId: 'clip-1',
        startUs: 2000000,
        quantizeToFrames: false,
      },
      { historyMode: 'debounced' },
    );

    infoSection.vm.$emit('update-end-time', 7000000);
    await nextTick();
    expect(mockTimelineStore.applyTimeline).toHaveBeenCalledWith(
      {
        type: 'trim_item',
        trackId: 'track-1',
        itemId: 'clip-1',
        edge: 'end',
        deltaUs: 1000000,
      },
      { historyMode: 'debounced' },
    );

    expect(infoSection.vm.$.emitsOptions).not.toHaveProperty('update-duration');
  });

  it('updates opacity and blendMode correctly', async () => {
    const clip = createClip();
    const wrapper = await mountComponent({ clip });

    // Switch to video tab where opacity/blendMode sections are rendered
    await wrapper.find('[data-tab="video"]').trigger('click');
    await nextTick();

    const opacitySection = wrapper.findComponent({ name: 'ClipOpacitySection' });
    expect(opacitySection.exists()).toBe(true);
    opacitySection.vm.$emit('update-opacity', 0.5);
    await nextTick();
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      opacity: 0.5,
    });

    const blendingSection = wrapper.findComponent({ name: 'ClipBlendingModeSection' });
    expect(blendingSection.exists()).toBe(true);
    blendingSection.vm.$emit('update-blend-mode', 'multiply');
    await nextTick();
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      blendMode: 'multiply',
    });

    blendingSection.vm.$emit('update-blend-mode', 'overlay');
    await nextTick();
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      blendMode: 'overlay',
    });

    blendingSection.vm.$emit('update-blend-mode', 'soft-light');
    await nextTick();
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      blendMode: 'soft-light',
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

    const actionsSection = wrapper.findComponent({ name: 'ClipActionsSection' });
    expect(actionsSection.exists()).toBe(true);

    actionsSection.vm.$emit('copy');
    await nextTick();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'copy',
      items: [{ sourceTrackId: 'track-1', clip: { id: 'clip-1' } }],
    });

    actionsSection.vm.$emit('cut');
    await nextTick();
    expect(mockClipboardStore.setClipboardPayload).toHaveBeenCalledWith({
      source: 'timeline',
      operation: 'cut',
      items: [{ sourceTrackId: 'track-1', clip: { id: 'clip-1' } }],
    });
  });

  it('toggles supported video parameter groups correctly', async () => {
    const clip = createClip({
      opacityActive: true,
      blendModeActive: true,
      transformActive: true,
      maskActive: true,
    });
    const wrapper = await mountComponent({ clip });

    // Switch to video tab where these sections are rendered
    await wrapper.find('[data-tab="video"]').trigger('click');
    await nextTick();

    // v-model:enabled emits update:enabled which triggers the computed setter
    const opacitySection = wrapper.findComponent({ name: 'ClipOpacitySection' });
    expect(opacitySection.exists()).toBe(true);
    opacitySection.vm.$emit('update:enabled', false);
    await nextTick();
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      opacityActive: false,
    });

    const blendingSection = wrapper.findComponent({ name: 'ClipBlendingModeSection' });
    expect(blendingSection.exists()).toBe(true);
    blendingSection.vm.$emit('update:enabled', false);
    await nextTick();
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      blendModeActive: false,
    });

    const transformSection = wrapper.findComponent({ name: 'ClipTransformSection' });
    expect(transformSection.exists()).toBe(true);
    transformSection.vm.$emit('update:enabled', false);
    await nextTick();
    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      transformActive: false,
    });

    // ClipMaskSection requires experimentalFeatures to be true
    const maskSection = wrapper.findComponent({ name: 'ClipMaskSection' });
    if (maskSection.exists()) {
      maskSection.vm.$emit('update:enabled', false);
      await nextTick();
      expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
        maskActive: false,
      });
    }
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

  it('renders flat layout without tabs for adjustment clips', async () => {
    const clip = createClip({ clipType: 'adjustment' });
    const wrapper = await mountComponent({ clip });

    // Tabs should not be rendered for adjustment clips
    expect(wrapper.find('.tabs-stub').exists()).toBe(false);

    // Effects editor should be rendered
    const effectsEditor = wrapper.findComponent({ name: 'ClipEffectsEditor' });
    expect(effectsEditor.exists()).toBe(true);

    // Transitions section should be rendered (non-mobile)
    const transitionsSection = wrapper.findComponent({ name: 'ClipTransitionsSection' });
    expect(transitionsSection.exists()).toBe(true);

    // Actions section should be rendered
    const actionsSection = wrapper.findComponent({ name: 'ClipActionsSection' });
    expect(actionsSection.exists()).toBe(true);

    // Info section (duration) should be rendered
    const infoSection = wrapper.findComponent({ name: 'ClipInfoSection' });
    expect(infoSection.exists()).toBe(true);
  });

  it('shows video effects for a clip with existing video effects even on a non-video track', async () => {
    mockTimelineStore.timelineDoc.tracks = [{ id: 'track-1', kind: 'audio', items: [] }];
    const clip = createClip({
      effects: [{ id: 'effect-1', type: 'blur', enabled: true, target: 'video', radius: 10 }],
    });
    const wrapper = await mountComponent({ clip });

    const videoTab = wrapper.find('[data-tab="video"]');
    expect(videoTab.exists()).toBe(true);

    await videoTab.trigger('click');
    await nextTick();

    const effectsEditor = wrapper.findComponent({ name: 'ClipEffectsEditor' });
    expect(effectsEditor.exists()).toBe(true);
    expect(effectsEditor.props('target')).toBe('video');
    expect(effectsEditor.props('effects')).toEqual(clip.effects);
  });

  it('preserves video effect order when clip properties update the video effects stack', async () => {
    const audioEffect = { id: 'audio-1', type: 'echo', enabled: true, target: 'audio' };
    const clip = createClip({
      effects: [{ id: 'video-1', type: 'brightness', enabled: true, target: 'video' }, audioEffect],
    });
    const wrapper = await mountComponent({ clip });

    await wrapper.find('[data-tab="video"]').trigger('click');
    await nextTick();

    const nextVideoEffects = [
      { id: 'video-1', type: 'brightness', enabled: true, target: 'video' },
      { id: 'video-2', type: 'blur', enabled: true, target: 'video' },
    ];
    wrapper
      .findAllComponents({ name: 'ClipEffectsEditor' })
      .find((c) => c.props('target') === 'video')
      ?.vm.$emit('update:effects', nextVideoEffects);
    await nextTick();

    expect(mockTimelineStore.updateClipProperties).toHaveBeenCalledWith('track-1', 'clip-1', {
      effects: [...nextVideoEffects, audioEffect],
    });
  });

  it('renders video effects after transitions in the video tab', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
    const wrapper = await mountComponent({ clip: createClip() });

    await wrapper.find('[data-tab="video"]').trigger('click');
    await nextTick();

    const effects = wrapper
      .findAllComponents({ name: 'ClipEffectsEditor' })
      .find((c) => c.props('target') === 'video');
    const blending = wrapper.findComponent({ name: 'ClipBlendingModeSection' });
    const opacity = wrapper.findComponent({ name: 'ClipOpacitySection' });
    const transform = wrapper.findComponent({ name: 'ClipTransformSection' });
    const mask = wrapper.findComponent({ name: 'ClipMaskSection' });
    const transitions = wrapper.findComponent({ name: 'ClipTransitionsSection' });

    expect(effects?.exists()).toBe(true);
    expect(blending.exists()).toBe(true);
    expect(opacity.exists()).toBe(true);
    expect(transform.exists()).toBe(true);
    expect(mask.exists()).toBe(true);
    expect(transitions.exists()).toBe(true);
    expect(blending.element.compareDocumentPosition(effects!.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(opacity.element.compareDocumentPosition(effects!.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(transform.element.compareDocumentPosition(effects!.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(mask.element.compareDocumentPosition(effects!.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(transitions.element.compareDocumentPosition(effects!.element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('hides audio effects editor when in-development features are disabled', async () => {
    const clip = createClip();
    const wrapper = await mountComponent({ clip });

    await wrapper.find('[data-tab="audio"]').trigger('click');
    await nextTick();

    const audioEffectsEditor = wrapper
      .findAllComponents({ name: 'ClipEffectsEditor' })
      .find((c) => c.props('target') === 'audio');
    expect(audioEffectsEditor).toBeUndefined();
  });

  it('shows audio effects editor when in-development features are enabled', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
    const clip = createClip();
    const wrapper = await mountComponent({ clip });

    await wrapper.find('[data-tab="audio"]').trigger('click');
    await nextTick();

    const audioEffectsEditor = wrapper
      .findAllComponents({ name: 'ClipEffectsEditor' })
      .find((c) => c.props('target') === 'audio');
    expect(audioEffectsEditor).toBeDefined();
  });
});
