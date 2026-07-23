import { describe, expect, it, vi, beforeEach } from 'vitest';
import { computed, reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TrackProperties from '~/components/properties/TrackProperties.vue';

vi.mock('~/components/properties/PropertySection.vue', () => ({
  default: { name: 'PropertySection', template: '<section><slot /></section>' },
}));

vi.mock('~/components/properties/PropertyRow.vue', () => ({
  default: { name: 'PropertyRow', props: ['label', 'value'], template: '<div />' },
}));

vi.mock('~/components/properties/PropertyActionsBlock.vue', () => ({
  default: {
    name: 'PropertyActionsBlock',
    props: ['quickActions', 'additionalActions'],
    template: '<div />',
  },
}));

vi.mock('~/components/effects/ClipEffectsEditor.vue', () => ({
  default: {
    name: 'ClipEffectsEditor',
    props: ['target', 'effects', 'hasToggle', 'disabled'],
    emits: ['update:effects', 'update:enabled'],
    template: '<div :data-testid="`track-effects-${target}`" />',
  },
}));

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    name: 'UiSliderInput',
    props: {
      modelValue: Number,
      label: String,
      min: Number,
      max: Number,
      step: Number,
      defaultValue: Number,
      decimals: Number,
      unit: String,
      showInputUnit: Boolean,
    },
    emits: ['update:modelValue'],
    template: '<div class="slider-input-stub">{{ modelValue }}{{ unit }}</div>',
  },
}));

vi.mock('~/components/ui/UiConfirmModal.vue', () => ({
  default: {
    name: 'UiConfirmModal',
    props: ['open'],
    emits: ['update:open', 'confirm'],
    template:
      '<div v-if="open" data-testid="confirm-modal"><button data-testid="confirm-btn" @click="$emit(\'confirm\')" /></div>',
  },
}));

vi.mock('~/components/ui/UiRenameModal.vue', () => ({
  default: {
    name: 'UiRenameModal',
    props: ['open', 'currentName', 'title'],
    emits: ['update:open', 'rename'],
    template: '<div v-if="open" data-testid="rename-modal" />',
  },
}));

vi.mock('~/components/ui/UiColorPicker.vue', () => ({
  default: {
    name: 'UiColorPicker',
    props: ['modelValue', 'mode'],
    emits: ['update:modelValue'],
    template: '<div data-testid="color-picker" />',
  },
}));

vi.mock('~/components/properties/GenerateCaptionsModal.vue', () => ({
  default: { name: 'GenerateCaptionsModal', template: '<div />' },
}));

const mockExtraActions = ref([] as any[]);
vi.mock('~/composables/properties/useTrackExtraActions', () => ({
  useTrackExtraActions: () => ({ extraActions: computed(() => mockExtraActions.value) }),
}));

const mockTimelineStore = reactive({
  updateTrackProperties: vi.fn(),
  renameTrack: vi.fn(),
  deleteTrack: vi.fn(),
  toggleTrackAudioMuted: vi.fn(),
  toggleTrackAudioSolo: vi.fn(),
  timelineDoc: { tracks: [] as any[] },
});

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: false,
  userSettings: { deleteWithoutConfirmation: true },
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

describe('TrackProperties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    mockWorkspaceStore.userSettings.deleteWithoutConfirmation = true;
    mockExtraActions.value = [];
    mockTimelineStore.timelineDoc.tracks = [];
  });

  function createTrack(overrides: Record<string, any> = {}) {
    return {
      id: 'track-1',
      kind: 'audio' as const,
      name: 'Track 1',
      items: [] as any[],
      ...overrides,
    };
  }

  async function mountComponent(props: Record<string, any> = {}) {
    return await mountSuspended(TrackProperties, {
      props: { track: createTrack(), ...props },
    });
  }

  it('shows and edits track volume as percent while storing gain', async () => {
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({ kind: 'audio', audioGain: 1.76 }),
    });

    const volumeSlider = wrapper.findComponent({ name: 'UiSliderInput' });

    expect(volumeSlider.props('modelValue')).toBe(176);
    expect(volumeSlider.props('max')).toBe(200);
    expect(volumeSlider.props('unit')).toBe('%');

    await volumeSlider.vm.$emit('update:modelValue', 150);

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      audioGain: 1.5,
    });
  });

  it('shows and edits audio balance clamped to [-1, 1]', async () => {
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({ kind: 'audio', audioBalance: 0.5 }),
    });

    const sliders = wrapper.findAllComponents({ name: 'UiSliderInput' });
    const balanceSlider = sliders[1];
    expect(balanceSlider.props('modelValue')).toBe(0.5);
    expect(balanceSlider.props('min')).toBe(-1);
    expect(balanceSlider.props('max')).toBe(1);

    await balanceSlider.vm.$emit('update:modelValue', 0.8);
    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      audioBalance: 0.8,
    });
  });

  it('clamps audio balance from invalid values', async () => {
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({ kind: 'audio', audioBalance: 2 }),
    });

    const sliders = wrapper.findAllComponents({ name: 'UiSliderInput' });
    // Balance should be clamped to 1 on read
    expect(sliders[1].props('modelValue')).toBe(1);
  });

  it('renames track via rename modal', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ name: 'Old Name' }),
    });

    const renameModal = wrapper.findComponent({ name: 'UiRenameModal' });
    expect(renameModal.exists()).toBe(true);
    expect(renameModal.props('currentName')).toBe('Old Name');

    renameModal.vm.$emit('rename', 'New Name');
    await wrapper.vm.$nextTick();

    expect(mockTimelineStore.renameTrack).toHaveBeenCalledWith('track-1', 'New Name');
  });

  it('trims whitespace when renaming', async () => {
    const wrapper = await mountComponent();

    const renameModal = wrapper.findComponent({ name: 'UiRenameModal' });
    renameModal.vm.$emit('rename', '  Spaced  ');
    await wrapper.vm.$nextTick();

    expect(mockTimelineStore.renameTrack).toHaveBeenCalledWith('track-1', 'Spaced');
  });

  it('deletes empty track without confirmation when deleteWithoutConfirmation is true', async () => {
    const wrapper = await mountComponent();

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{
      id: string;
      onClick: () => void;
    }>;
    const deleteAction = quickActions.find((a) => a.id === 'delete');
    expect(deleteAction).toBeDefined();
    deleteAction!.onClick();

    expect(mockTimelineStore.deleteTrack).toHaveBeenCalledWith('track-1', { allowNonEmpty: true });
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(false);
  });

  it('opens confirm modal when deleting non-empty track without skip setting', async () => {
    mockWorkspaceStore.userSettings.deleteWithoutConfirmation = false;
    const wrapper = await mountComponent({
      track: createTrack({ items: [{ id: 'clip-1', kind: 'clip' }] }),
    });

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{
      id: string;
      onClick: () => void;
    }>;
    const deleteAction = quickActions.find((a) => a.id === 'delete');
    deleteAction!.onClick();
    await wrapper.vm.$nextTick();

    expect(mockTimelineStore.deleteTrack).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(true);
  });

  it('confirms delete via confirm modal', async () => {
    mockWorkspaceStore.userSettings.deleteWithoutConfirmation = false;
    const wrapper = await mountComponent({
      track: createTrack({ items: [{ id: 'clip-1', kind: 'clip' }] }),
    });

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{
      id: string;
      onClick: () => void;
    }>;
    quickActions.find((a) => a.id === 'delete')!.onClick();
    await wrapper.vm.$nextTick();

    const confirmModal = wrapper.findComponent({ name: 'UiConfirmModal' });
    confirmModal.vm.$emit('confirm');
    await wrapper.vm.$nextTick();

    expect(mockTimelineStore.deleteTrack).toHaveBeenCalledWith('track-1', { allowNonEmpty: true });
  });

  it('toggles track muted via quick action', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ audioMuted: false }),
    });

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{
      id: string;
      onClick: () => void;
    }>;
    const muteAction = quickActions.find((a) => a.id === 'toggle-track-muted');
    expect(muteAction).toBeDefined();
    muteAction!.onClick();

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      audioMuted: true,
    });
  });

  it('toggles track solo via quick action', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ audioSolo: false }),
    });

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{
      id: string;
      onClick: () => void;
    }>;
    const soloAction = quickActions.find((a) => a.id === 'toggle-solo');
    expect(soloAction).toBeDefined();
    soloAction!.onClick();

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      audioSolo: true,
    });
  });

  it('toggles track locked via quick action', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ locked: false }),
    });

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{
      id: string;
      onClick: () => void;
    }>;
    const lockAction = quickActions.find((a) => a.id === 'toggle-track-locked');
    expect(lockAction).toBeDefined();
    lockAction!.onClick();

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      locked: true,
    });
  });

  it('toggles video hidden for video track', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ kind: 'video', videoHidden: false }),
    });

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{
      id: string;
      onClick: () => void;
    }>;
    const hideAction = quickActions.find((a) => a.id === 'toggle-video-hidden');
    expect(hideAction).toBeDefined();
    hideAction!.onClick();

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      videoHidden: true,
    });
  });

  it('does not show video hidden toggle for audio track', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ kind: 'audio' }),
    });

    const quickActions = (wrapper.vm as any).trackQuickActions as Array<{ id: string }>;
    expect(quickActions.find((a) => a.id === 'toggle-video-hidden')).toBeUndefined();
  });

  it('updates track color via color picker', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ color: '#ff0000' }),
    });

    const colorPicker = wrapper.findComponent({ name: 'UiColorPicker' });
    expect(colorPicker.exists()).toBe(true);
    expect(colorPicker.props('modelValue')).toBe('#ff0000');

    colorPicker.vm.$emit('update:modelValue', '#00ff00');
    await wrapper.vm.$nextTick();

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      color: '#00ff00',
    });
  });

  it('uses default color when track has no color', async () => {
    const wrapper = await mountComponent();

    const colorPicker = wrapper.findComponent({ name: 'UiColorPicker' });
    expect(colorPicker.props('modelValue')).toBe('#2a2a2a');
  });

  it('shows correct clip count', async () => {
    const wrapper = await mountComponent({
      track: createTrack({
        items: [
          { id: 'c1', kind: 'clip' },
          { id: 'c2', kind: 'clip' },
          { id: 'g1', kind: 'gap' },
        ],
      }),
    });

    expect((wrapper.vm as any).clipCount).toBe(2);
  });

  it('renders video effects editor for video track', async () => {
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({ kind: 'video', effects: [{ id: 'e1', type: 'blur', target: 'video' }] }),
    });

    const videoEditor = wrapper.find('[data-testid="track-effects-video"]');
    expect(videoEditor.exists()).toBe(true);
  });

  it('does not render video effects editor for audio track', async () => {
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({ kind: 'audio' }),
    });

    expect(wrapper.find('[data-testid="track-effects-video"]').exists()).toBe(false);
  });

  it('hides audio effects editor when in-development features are disabled', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({ kind: 'audio' }),
    });

    expect(wrapper.find('[data-testid="track-effects-audio"]').exists()).toBe(false);
  });

  it('shows audio effects editor when in-development features are enabled', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({ kind: 'audio' }),
    });

    expect(wrapper.find('[data-testid="track-effects-audio"]').exists()).toBe(true);
  });

  it('updates video effects preserving audio effects', async () => {
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({
        kind: 'video',
        effects: [
          { id: 'v1', type: 'blur', target: 'video' },
          { id: 'a1', type: 'echo', target: 'audio' },
        ],
      }),
    });

    (wrapper.vm as any).handleUpdateTrackEffects([
      { id: 'v1', type: 'blur', target: 'video' },
      { id: 'v2', type: 'brightness', target: 'video' },
    ]);

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      effects: [
        { id: 'v1', type: 'blur', target: 'video' },
        { id: 'v2', type: 'brightness', target: 'video' },
        { id: 'a1', type: 'echo', target: 'audio' },
      ],
    });
  });

  it('updates audio effects preserving video effects', async () => {
    const wrapper = await mountComponent({
      hideActions: true,
      track: createTrack({
        kind: 'video',
        effects: [
          { id: 'v1', type: 'blur', target: 'video' },
          { id: 'a1', type: 'echo', target: 'audio' },
        ],
      }),
    });

    (wrapper.vm as any).handleUpdateTrackAudioEffects([
      { id: 'a1', type: 'echo', target: 'audio' },
      { id: 'a2', type: 'reverb', target: 'audio' },
    ]);

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      effects: [
        { id: 'v1', type: 'blur', target: 'video' },
        { id: 'a1', type: 'echo', target: 'audio' },
        { id: 'a2', type: 'reverb', target: 'audio' },
      ],
    });
  });

  it('hides actions section when hideActions is true', async () => {
    const wrapper = await mountComponent({ hideActions: true });

    const actionsBlock = wrapper.findComponent({ name: 'PropertyActionsBlock' });
    expect(actionsBlock.exists()).toBe(false);
  });

  it('hides quick actions on mobile but keeps extra actions', async () => {
    const wrapper = await mountComponent({ isMobile: true });

    const actionsBlock = wrapper.findComponent({ name: 'PropertyActionsBlock' });
    expect(actionsBlock.exists()).toBe(true);
    expect(actionsBlock.props('quickActions')).toEqual([]);
  });

  it('renders generate captions modal for video track', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ kind: 'video' }),
    });

    expect(wrapper.findComponent({ name: 'GenerateCaptionsModal' }).exists()).toBe(true);
  });

  it('does not render generate captions modal for audio track', async () => {
    const wrapper = await mountComponent({
      track: createTrack({ kind: 'audio' }),
    });

    expect(wrapper.findComponent({ name: 'GenerateCaptionsModal' }).exists()).toBe(false);
  });
});
