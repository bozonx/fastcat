import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import AudioMixer from '~/components/audio/AudioMixer.vue';
import { reactive } from 'vue';

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        kind: 'audio',
        items: [{ id: 'clip-1', kind: 'clip' }],
      },
    ],
  },
  selectedTrackId: null as string | null,
  selectedItemIds: [] as string[],
  selectTrack: vi.fn(),
  clearSelection: vi.fn(),
});

const mockMediaStore = reactive({
  mediaMetadata: {},
  getCachedMetadata: vi.fn((path: string) => mockMediaStore.mediaMetadata[path]),
});

const mockFocusStore = reactive({
  isPanelFocused: vi.fn(() => false),
  setPanelFocus: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mockMediaStore,
}));

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => mockFocusStore,
}));

vi.mock('~/components/audio/AudioMixerMain.vue', () => ({
  default: {
    name: 'AudioMixerMain',
    props: ['isSelected'],
    template: '<div class="mock-mixer-main" :class="{ selected: isSelected }">Main Bus</div>',
  },
}));

vi.mock('~/components/audio/AudioMixerTrack.vue', () => ({
  default: {
    name: 'AudioMixerTrack',
    props: ['track', 'isSelected'],
    template:
      '<div class="mock-mixer-track" :class="{ selected: isSelected }">Track: {{ track.id }}</div>',
  },
}));

describe('AudioMixer.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.selectedTrackId = null;
    mockTimelineStore.selectedItemIds = [];
    mockFocusStore.isPanelFocused.mockReturnValue(false);
  });

  it('renders main bus and track correctly', async () => {
    const component = await mountWithNuxt(AudioMixer);

    expect(component.exists()).toBe(true);
    expect(component.find('.mock-mixer-main').exists()).toBe(true);
    expect(component.find('.mock-mixer-track').exists()).toBe(true);
    expect(component.find('.mock-mixer-track').text()).toContain('track-1');
  });

  it('sets panel focus on pointerdown', async () => {
    const component = await mountWithNuxt(AudioMixer);

    await component.trigger('pointerdown');
    expect(mockFocusStore.setPanelFocus).toHaveBeenCalledWith('audioMixer');
  });

  it('handles main bus selection correctly', async () => {
    mockFocusStore.isPanelFocused.mockReturnValue(true);
    mockTimelineStore.selectedTrackId = null;
    mockTimelineStore.selectedItemIds = [];

    const component = await mountWithNuxt(AudioMixer);

    const mainBus = component.find('.mock-mixer-main');
    expect(mainBus.classes()).toContain('selected');
  });

  it('handles track selection correctly', async () => {
    mockTimelineStore.selectedTrackId = 'track-1';

    const component = await mountWithNuxt(AudioMixer);

    const track = component.find('.mock-mixer-track');
    expect(track.classes()).toContain('selected');
  });

  it('calls selectTrack and sets panel focus when clicking a track', async () => {
    const component = await mountWithNuxt(AudioMixer);

    const track = component.find('.mock-mixer-track');
    await track.trigger('click');

    expect(mockFocusStore.setPanelFocus).toHaveBeenCalledWith('audioMixer');
    expect(mockTimelineStore.selectTrack).toHaveBeenCalledWith('track-1');
  });

  it('calls clearSelection and selectTrack(null) when clicking main bus', async () => {
    const component = await mountWithNuxt(AudioMixer);

    const mainBus = component.find('.mock-mixer-main');
    await mainBus.trigger('click');

    expect(mockFocusStore.setPanelFocus).toHaveBeenCalledWith('audioMixer');
    expect(mockTimelineStore.clearSelection).toHaveBeenCalled();
    expect(mockTimelineStore.selectTrack).toHaveBeenCalledWith(null);
  });
});
