import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileClipDeleteDrawer from '~/components/timeline/MobileClipDeleteDrawer.vue';

const handleDeleteClip = vi.fn();
const rippleDeleteFirstSelectedItem = vi.fn();
const rippleDeleteSelectedClipRangeAllTracks = vi.fn();

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

    // Three action rows, each rendered as a plain button (not the legacy
    // grid-cols-3 UButton layout). Find them by their leading icon.
    const deleteLiftBtn = wrapper.find('div.flex.flex-col button.flex');
    const buttons = wrapper.findAll('div.flex.flex-col button.flex');
    expect(buttons).toHaveLength(3);
    expect(deleteLiftBtn.exists()).toBe(true);

    // Order in the template: rippleDelete (backspace), deleteLift (trash),
    // extractRange (scissors).
    await buttons[0].trigger('click');
    expect(rippleDeleteFirstSelectedItem).toHaveBeenCalledOnce();

    await buttons[1].trigger('click');
    expect(handleDeleteClip).toHaveBeenCalledOnce();

    await buttons[2].trigger('click');
    expect(rippleDeleteSelectedClipRangeAllTracks).toHaveBeenCalledOnce();
    expect(wrapper.emitted('close')).toHaveLength(3);
  });

  it('disables all actions when the clip track is locked', async () => {
    mockTimelineStore.timelineDoc.tracks[0].locked = true;

    const wrapper = await mountSuspended(MobileClipDeleteDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });

    const actionButtons = wrapper.findAll('div.flex.flex-col button.flex');
    expect(actionButtons).toHaveLength(3);
    for (const button of actionButtons) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });
});
