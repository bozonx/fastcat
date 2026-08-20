import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, computed } from 'vue';
import AudioMixerMain from '~/components/audio/AudioMixerMain.vue';

// Mock subcomponents
vi.mock('~/components/audio/DbSlider.vue', () => ({
  default: {
    name: 'DbSlider',
    template: '<div><input type="range" class="mock-db-slider" /></div>',
    props: ['modelValue', 'levelDb', 'maxDb'],
  },
}));
vi.mock('~/components/effects/SelectEffectModal.vue', () => ({
  default: { name: 'SelectEffectModal', template: '<div></div>' },
}));
vi.mock('~/components/audio/MasterAudioEffectsModal.vue', () => ({
  default: { name: 'MasterAudioEffectsModal', template: '<div></div>' },
}));

const mockTimelineStore = reactive({
  audioLevels: {},
  masterGain: 1, // 0 dB
  audioMuted: false,
  timelineDoc: { metadata: { fastcat: { masterEffects: [] } } },
  setMasterGain: vi.fn(),
  applyTimeline: vi.fn(),
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: computed(() => true),
});

vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

describe('AudioMixerMain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.audioMuted = false;
    mockTimelineStore.masterGain = 1;
  });

  it('renders master track correctly', async () => {
    const component = await mountSuspended(AudioMixerMain);

    expect(component.text()).toContain('0.0 dB');
    expect(component.text()).toContain('fastcat.audioMixer.main'); // Title
  });

  it('limits master gain slider to 200%', async () => {
    const component = await mountSuspended(AudioMixerMain);

    const dbSlider = component.findComponent({ name: 'DbSlider' });

    expect(dbSlider.props('maxDb')).toBe(6.0206);
  });

  it('toggles master mute', async () => {
    const component = await mountSuspended(AudioMixerMain);

    const buttons = component.findAll('button');
    const muteBtn = buttons.find((b) => b.text().toLowerCase().includes('mute'));

    await muteBtn?.trigger('click');
    expect(mockTimelineStore.audioMuted).toBe(true);

    await muteBtn?.trigger('click');
    expect(mockTimelineStore.audioMuted).toBe(false);
  });

  it('hides the effects block when in-development features are disabled', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = computed(() => false);

    const component = await mountSuspended(AudioMixerMain);

    const buttons = component.findAll('button');
    const effectBtn = buttons.find((b) => b.text().toLowerCase().includes('effect'));
    expect(effectBtn).toBeUndefined();
  });
});
