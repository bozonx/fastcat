import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileClipTrimOptionsDrawer from '~/components/timeline/MobileClipTrimOptionsDrawer.vue';

const trimToPlayheadLeftNoRipple = vi.fn();
const trimToPlayheadRightNoRipple = vi.fn();
const rippleTrimLeft = vi.fn();
const rippleTrimRight = vi.fn();

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        kind: 'video',
        locked: false,
        items: [
          {
            id: 'clip-1',
            kind: 'clip',
            clipType: 'media',
            locked: false,
            trackId: 'track-1',
          },
        ],
      },
    ],
  },
  trimToPlayheadLeftNoRipple,
  trimToPlayheadRightNoRipple,
  rippleTrimLeft,
  rippleTrimRight,
});

const mockSelectionStore = reactive({
  selectedEntity: {
    source: 'timeline',
    kind: 'clip',
    itemId: 'clip-1',
    trackId: 'track-1',
  },
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open'],
      template: '<div><slot name="header" /><slot /></div>',
    },
    UButton: {
      props: ['icon', 'disabled'],
      emits: ['click'],
      template:
        '<button :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
  },
};

describe('MobileClipTrimOptionsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.timelineDoc.tracks[0].locked = false;
    mockTimelineStore.timelineDoc.tracks[0].items[0].locked = false;
  });

  it('renders trim actions and emits navigation events', async () => {
    const wrapper = await mountSuspended(MobileClipTrimOptionsDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    expect(wrapper.text()).toContain('fastcat.timeline.trimByPlayhead');

    await wrapper.find('button[data-icon="i-heroicons-chevron-left"]').trigger('click');
    expect(wrapper.emitted('back')).toBeTruthy();

    await wrapper.find('button[data-icon="i-heroicons-x-mark"]').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('executes trim actions and navigates back', async () => {
    const wrapper = await mountSuspended(MobileClipTrimOptionsDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const buttons = wrapper.findAll('div.grid.grid-cols-2 button');
    expect(buttons).toHaveLength(4);

    await buttons[0].trigger('click');
    expect(trimToPlayheadLeftNoRipple).toHaveBeenCalledOnce();

    await buttons[1].trigger('click');
    expect(trimToPlayheadRightNoRipple).toHaveBeenCalledOnce();

    await buttons[2].trigger('click');
    expect(rippleTrimLeft).toHaveBeenCalledOnce();

    await buttons[3].trigger('click');
    expect(rippleTrimRight).toHaveBeenCalledOnce();

    expect(wrapper.emitted('back')).toHaveLength(4);
  });

  it('disables all trim actions when clip is locked', async () => {
    mockTimelineStore.timelineDoc.tracks[0].locked = true;

    const wrapper = await mountSuspended(MobileClipTrimOptionsDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const buttons = wrapper.findAll('div.grid.grid-cols-2 button');
    expect(buttons).toHaveLength(4);
    for (const btn of buttons) {
      expect(btn.attributes('disabled')).toBeDefined();
    }
  });
});
