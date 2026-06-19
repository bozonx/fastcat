import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileClipDeleteDrawer from '~/components/timeline/MobileClipDeleteDrawer.vue';

const handleDeleteClip = vi.fn();
const rippleDeleteFirstSelectedItem = vi.fn();
const rippleDeleteSelectedClipRangeAllTracks = vi.fn();
const trimToPlayheadLeftNoRipple = vi.fn();
const trimToPlayheadRightNoRipple = vi.fn();
const rippleTrimLeft = vi.fn();
const rippleTrimRight = vi.fn();
const advancedRippleTrimLeft = vi.fn();
const advancedRippleTrimRight = vi.fn();

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
  rippleDeleteFirstSelectedItem,
  rippleDeleteSelectedClipRangeAllTracks,
  trimToPlayheadLeftNoRipple,
  trimToPlayheadRightNoRipple,
  rippleTrimLeft,
  rippleTrimRight,
  advancedRippleTrimLeft,
  advancedRippleTrimRight,
});

const mockSelectionStore = reactive({
  selectedEntity: {
    source: 'timeline',
    kind: 'clip',
    itemId: 'clip-1',
    trackId: 'track-1',
  },
});

vi.mock('~/composables/properties/useClipPropertiesActions', () => ({
  useClipPropertiesActions: () => ({ handleDeleteClip }),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({}),
}));

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => ({}),
}));

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => ({}),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({}),
}));

vi.mock('~/stores/project-tabs.store', () => ({
  useProjectTabsStore: () => ({ setActiveTab: vi.fn() }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({}),
}));

const globalOptions = {
  stubs: {
    MobileTimelineDrawer: {
      props: ['open', 'initialMode'],
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

describe('MobileClipDeleteDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.timelineDoc.tracks[0].locked = false;
    mockTimelineStore.timelineDoc.tracks[0].items[0].locked = false;
  });

  it('renders delete actions and emits navigation events', async () => {
    const wrapper = await mountSuspended(MobileClipDeleteDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    expect(wrapper.text()).toContain('fastcat.timeline.deleteLift');
    expect(wrapper.text()).toContain('fastcat.timeline.rippleDelete');
    expect(wrapper.text()).toContain('fastcat.timeline.extractRange');

    await wrapper.find('button[data-icon="i-heroicons-chevron-left"]').trigger('click');
    expect(wrapper.emitted('back')).toBeTruthy();

    await wrapper.find('button[data-icon="i-heroicons-x-mark"]').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('runs delete actions and closes the drawer', async () => {
    const wrapper = await mountSuspended(MobileClipDeleteDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const actionButtons = wrapper.findAll('.grid-cols-3 button');
    expect(actionButtons).toHaveLength(3);

    await actionButtons[0].trigger('click');
    expect(handleDeleteClip).toHaveBeenCalledOnce();

    await actionButtons[1].trigger('click');
    expect(rippleDeleteFirstSelectedItem).toHaveBeenCalledOnce();

    await actionButtons[2].trigger('click');
    expect(rippleDeleteSelectedClipRangeAllTracks).toHaveBeenCalledOnce();
    expect(wrapper.emitted('close')).toHaveLength(3);
  });

  it('runs trim actions and returns to clip properties', async () => {
    const wrapper = await mountSuspended(MobileClipDeleteDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const trimButtons = wrapper.findAll('.grid-cols-2 button');
    expect(trimButtons).toHaveLength(6);

    await trimButtons[0].trigger('click');
    expect(trimToPlayheadLeftNoRipple).toHaveBeenCalledOnce();
    expect(wrapper.emitted('back')).toHaveLength(1);
  });

  it('disables all actions when the clip track is locked', async () => {
    mockTimelineStore.timelineDoc.tracks[0].locked = true;

    const wrapper = await mountSuspended(MobileClipDeleteDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const actionButtons = [
      ...wrapper.findAll('.grid-cols-3 button'),
      ...wrapper.findAll('.grid-cols-2 button'),
    ];
    expect(actionButtons).toHaveLength(9);
    for (const button of actionButtons) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });
});
