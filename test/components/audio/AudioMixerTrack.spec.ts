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

  it('allows renaming the track', async () => {
    const component = await mountSuspended(AudioMixerTrack, {
      props: { track: baseTrack },
    });

    // Find the track name div
    const nameDiv = component.find('.cursor-text');
    await nameDiv.trigger('click');

    // After click, input should appear
    const input = component.find(
      'input[type="text"]:not(.mock-pan):not(.mock-db-slider), input:not([type])',
    );
    expect(input.exists()).toBe(true);

    await input.setValue('New Audio Name');
    await input.trigger('blur');

    expect(mockTimelineStore.renameTrack).toHaveBeenCalledWith('track-1', 'New Audio Name');
  });
});
