import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileTrackMixerDrawer from '~/components/timeline/MobileTrackMixerDrawer.vue';

const toggleTrackAudioMutedMock = vi.fn();
const toggleTrackAudioSoloMock = vi.fn();
const updateTrackPropertiesMock = vi.fn();
const requestTimelineSaveMock = vi.fn();

const audioTrack = {
  id: 'track-a',
  kind: 'audio',
  items: [{ id: 'item-a' }],
  audioGain: 1,
  audioMuted: false,
  audioSolo: false,
} as any;
const videoTrack = {
  id: 'track-v',
  kind: 'video',
  items: [{ id: 'item-v' }],
  audioGain: 0.8,
  audioMuted: false,
  audioSolo: false,
} as any;
const emptyTrack = { id: 'track-e', kind: 'audio', items: [], audioGain: 1 } as any;

const mockTimelineStore = reactive({
  timelineDoc: { tracks: [audioTrack, videoTrack, emptyTrack] },
  toggleTrackAudioMuted: toggleTrackAudioMutedMock,
  toggleTrackAudioSolo: toggleTrackAudioSoloMock,
  updateTrackProperties: updateTrackPropertiesMock,
  requestTimelineSave: requestTimelineSaveMock,
});

const mockMediaStore = reactive({
  mediaMetadata: {} as Record<string, any>,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mockMediaStore,
}));

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open', 'title'],
      emits: ['update:open'],
      template: '<div class="drawer"><slot /></div>',
    },
    DbSlider: {
      props: ['modelValue'],
      emits: ['update:modelValue'],
      template:
        '<input class="db-slider" type="range" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
    },
    TrackProperties: { template: '<div class="track-properties" />' },
    SelectEffectModal: { template: '<div class="select-effect-modal" />' },
    TrackAudioEffectsModal: { template: '<div class="track-effects-modal" />' },
    UiRenameModal: { template: '<div class="rename-modal" />' },
    UiToggleButton: {
      props: ['modelValue', 'icon', 'label'],
      emits: ['click'],
      template:
        '<button class="ui-toggle-button" :data-icon="icon" :data-label="label" @click="$emit(\'click\')"><slot /></button>',
    },
    UButton: {
      props: ['icon'],
      template: '<button class="u-button" :data-icon="icon"><slot /></button>',
    },
    UIcon: { props: ['name'], template: '<i :data-icon="name" />' },
  },
};

describe('MobileTrackMixerDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioTrack.audioMuted = false;
    audioTrack.audioSolo = false;
    videoTrack.audioMuted = false;
    videoTrack.audioSolo = false;
  });

  it('renders the drawer', async () => {
    const wrapper = await mountSuspended(MobileTrackMixerDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });
    expect(wrapper.find('.drawer').exists()).toBe(true);
  });

  it('filters out tracks that have no audio', async () => {
    const wrapper = await mountSuspended(MobileTrackMixerDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });
    const sliders = wrapper.findAll('.db-slider');
    expect(sliders.length).toBe(2);
  });

  it('toggles mute when the mute button is clicked', async () => {
    const wrapper = await mountSuspended(MobileTrackMixerDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const muteButtons = wrapper.findAll('[data-label="M"]');
    expect(muteButtons.length).toBeGreaterThan(1);
    await muteButtons[1]!.trigger('click');
    expect(toggleTrackAudioMutedMock).toHaveBeenCalled();
    expect(requestTimelineSaveMock).toHaveBeenCalledWith({ immediate: true });
  });

  it('toggles solo when the solo button is clicked', async () => {
    const wrapper = await mountSuspended(MobileTrackMixerDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const soloButton = wrapper.find('[data-icon="i-heroicons-musical-note"]');
    expect(soloButton.exists()).toBe(true);
    await soloButton.trigger('click');
    expect(toggleTrackAudioSoloMock).toHaveBeenCalled();
  });

  it('updates track gain when the slider changes', async () => {
    const wrapper = await mountSuspended(MobileTrackMixerDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const sliders = wrapper.findAll('.db-slider');
    // Skip the master slider (first), use the first track slider
    await sliders[1]!.setValue(-6);
    expect(updateTrackPropertiesMock).toHaveBeenCalled();
  });
});
