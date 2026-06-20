import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileVirtualClipPresetDrawer from '~/components/timeline/MobileVirtualClipPresetDrawer.vue';

const addTextClipAtPlayheadMock = vi.fn();
const addVirtualClipAtPlayheadMock = vi.fn();
const resolveMobileTargetTrackIdMock = vi.fn(() => 'track-1');

const mockTimelineStore = reactive({
  resolveMobileTargetTrackId: resolveMobileTargetTrackIdMock,
  addTextClipAtPlayhead: addTextClipAtPlayheadMock,
  addVirtualClipAtPlayhead: addVirtualClipAtPlayheadMock,
  currentTime: 0,
});

const mockPresetsStore = reactive({
  customPresets: ref([] as any[]),
});

const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: { defaultStaticClipDurationUs: 5_000_000 },
  },
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => mockPresetsStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open', 'title'],
      emits: ['update:open'],
      template: '<div class="drawer"><h2>{{ title }}</h2><slot /></div>',
    },
  },
};

describe('MobileVirtualClipPresetDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the text drawer title', async () => {
    const wrapper = await mountSuspended(MobileVirtualClipPresetDrawer, {
      props: { isOpen: true, type: 'text' },
      global: globalOptions,
    });
    expect(wrapper.text()).toContain('fastcat.library.texts');
  });

  it('renders the shape drawer title', async () => {
    const wrapper = await mountSuspended(MobileVirtualClipPresetDrawer, {
      props: { isOpen: true, type: 'shape' },
      global: globalOptions,
    });
    expect(wrapper.text()).toContain('fastcat.library.shapes');
  });

  it('renders the hud drawer title', async () => {
    const wrapper = await mountSuspended(MobileVirtualClipPresetDrawer, {
      props: { isOpen: true, type: 'hud' },
      global: globalOptions,
    });
    expect(wrapper.text()).toContain('fastcat.library.hud');
  });

  it('adds a default text clip when a preset is selected', async () => {
    const wrapper = await mountSuspended(MobileVirtualClipPresetDrawer, {
      props: { isOpen: true, type: 'text' },
      global: globalOptions,
    });

    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    await buttons[0]!.trigger('click');

    expect(resolveMobileTargetTrackIdMock).toHaveBeenCalledWith('video', { durationUs: 5_000_000 });
    expect(addTextClipAtPlayheadMock).toHaveBeenCalled();
  });

  it('adds a shape clip when a shape preset is selected', async () => {
    const wrapper = await mountSuspended(MobileVirtualClipPresetDrawer, {
      props: { isOpen: true, type: 'shape' },
      global: globalOptions,
    });

    const buttons = wrapper.findAll('button');
    await buttons[0]!.trigger('click');

    expect(addVirtualClipAtPlayheadMock).toHaveBeenCalled();
  });

  it('emits close after adding a preset', async () => {
    const wrapper = await mountSuspended(MobileVirtualClipPresetDrawer, {
      props: { isOpen: true, type: 'text' },
      global: globalOptions,
    });

    const buttons = wrapper.findAll('button');
    await buttons[0]!.trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
