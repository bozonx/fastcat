import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
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

    const buttons = component.findAll('button');
    const muteBtn = buttons.find((b) => b.text().trim() === 'M');
    const soloBtn = buttons.find((b) => b.attributes('title') === 'Solo');

    await muteBtn?.trigger('click');
    expect(mockTimelineStore.toggleTrackAudioMuted).toHaveBeenCalledWith('track-1');

    await soloBtn?.trigger('click');
    expect(mockTimelineStore.toggleTrackAudioSolo).toHaveBeenCalledWith('track-1');
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
});
