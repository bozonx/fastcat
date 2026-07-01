import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, computed } from 'vue';
import AudioMixerTrack from '~/components/audio/AudioMixerTrack.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';

// Mock subcomponents
vi.mock('~/components/ui/UiWheelSlider.vue', () => ({
  default: {
    name: 'UiWheelSlider',
    template: '<div><input type="range" class="mock-pan" /></div>',
    props: ['modelValue'],
  },
}));
vi.mock('~/components/audio/DbSlider.vue', () => ({
  default: {
    name: 'DbSlider',
    template: '<div><input type="range" class="mock-db-slider" /></div>',
    props: ['modelValue', 'levelDb'],
  },
}));
vi.mock('~/components/effects/SelectEffectModal.vue', () => ({
  default: { name: 'SelectEffectModal', template: '<div></div>' },
}));
vi.mock('~/components/audio/TrackAudioEffectsModal.vue', () => ({
  default: { name: 'TrackAudioEffectsModal', template: '<div></div>' },
}));
vi.mock('~/components/ui/UiRenameModal.vue', () => ({
  default: {
    name: 'UiRenameModal',
    template: '<div></div>',
    props: ['open', 'currentName', 'title'],
    emits: ['update:open', 'rename'],
  },
}));

const mockTimelineStore = reactive({
  audioLevels: {},
  updateTrackProperties: vi.fn(),
  toggleTrackAudioMuted: vi.fn(),
  toggleTrackAudioSolo: vi.fn(),
  selectAllClipsOnTrack: vi.fn(),
  renameTrack: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: computed(() => true),
});

vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

describe('AudioMixerTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseTrack = {
    id: 'track-1',
    name: 'Audio 1',
    kind: 'audio',
    audioGain: 1, // 0 dB
    audioBalance: 0, // Center
    audioMuted: false,
    audioSolo: false,
    effects: [],
    items: [],
  };

  it('renders track name and properties correctly', async () => {
    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: baseTrack },
    });

    expect(component.text()).toContain('Audio 1');
    expect(component.text()).toContain('0.0 dB');
    expect(component.text()).toContain('C'); // Center Pan
  });

  it('calls store methods on mute and solo toggle', async () => {
    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: baseTrack },
    });

    // Mute and solo buttons are inside the controls div
    const controlsDiv = component.find('.flex.gap-1.mb-2');
    expect(controlsDiv.exists()).toBe(true);
    const buttons = controlsDiv.findAll('button');
    expect(buttons).toHaveLength(2);

    // First button is mute (label="M"), second is solo (icon only)
    const muteBtn = buttons[0]!;
    const soloBtn = buttons[1]!;

    expect(muteBtn.text().trim()).toBe('M');

    await muteBtn.trigger('click');
    expect(mockTimelineStore.toggleTrackAudioMuted).toHaveBeenCalledWith('track-1');

    await soloBtn.trigger('click');
    expect(mockTimelineStore.toggleTrackAudioSolo).toHaveBeenCalledWith('track-1');
  });

  it('updates track volume via DbSlider', async () => {
    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: baseTrack },
    });

    const dbSlider = component.findComponent({ name: 'DbSlider' });
    expect(dbSlider.exists()).toBe(true);

    // DbSlider uses v-model, emitting update:modelValue with new dB value
    await dbSlider.vm.$emit('update:modelValue', -6);

    // -6 dB → linear gain ≈ 0.501
    const calls = mockTimelineStore.updateTrackProperties.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('track-1');
    expect(calls[0]![1].audioGain).toBeCloseTo(dbToLinear(-6), 2);
  });

  it('updates track pan via UiWheelSlider', async () => {
    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: baseTrack },
    });

    const panSlider = component.findComponent({ name: 'UiWheelSlider' });
    expect(panSlider.exists()).toBe(true);

    await panSlider.vm.$emit('update:modelValue', 0.5);

    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      audioBalance: 0.5,
    });
  });

  it('resets volume to 0 dB when clicking the db value display', async () => {
    const trackWithLowVolume = {
      ...baseTrack,
      audioGain: dbToLinear(-20),
    };

    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: trackWithLowVolume },
    });

    // The db value display is inside a UiTooltip, click resets to 0 dB
    const dbDisplay = component.find('.text-xs.font-mono');
    expect(dbDisplay.exists()).toBe(true);
    expect(dbDisplay.text()).toContain('-20.0 dB');

    await dbDisplay.trigger('click');

    // 0 dB → linear gain 1.0
    expect(mockTimelineStore.updateTrackProperties).toHaveBeenCalledWith('track-1', {
      audioGain: 1,
    });
  });

  it('allows renaming the track via modal', async () => {
    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: baseTrack },
    });

    // Click the track name to open the rename modal
    const nameDiv = component.find('.cursor-text');
    await nameDiv.trigger('click');

    // The modal should be open
    expect(component.vm.isRenameModalOpen).toBe(true);

    // Simulate modal rename confirmation
    const modal = component.findComponent({ name: 'UiRenameModal' });
    expect(modal.exists()).toBe(true);
    await modal.vm.$emit('rename', 'New Audio Name');

    expect(mockTimelineStore.renameTrack).toHaveBeenCalledWith('track-1', 'New Audio Name');
  });

  it('hides the effects block when in-development features are disabled', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = computed(() => false);

    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: baseTrack },
    });

    const buttons = component.findAll('button');
    const effectBtn = buttons.find((b) => b.text().toLowerCase().includes('effect'));
    expect(effectBtn).toBeUndefined();
  });
});
