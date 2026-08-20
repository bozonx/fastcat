import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileClipPropertiesDrawer from '~/components/timeline/MobileClipPropertiesDrawer.vue';

const handleDeleteClip = vi.fn();
const handleToggleDisabled = vi.fn();
const handleToggleLocked = vi.fn();
const handleToggleMuted = vi.fn();

vi.mock('~/composables/properties/useClipPropertiesActions', () => ({
  useClipPropertiesActions: () => ({
    handleDeleteClip,
    handleToggleDisabled,
    handleToggleLocked,
    handleToggleMuted,
  }),
}));

vi.mock('~/components/properties/ClipProperties.vue', () => ({
  default: { template: '<div class="clip-properties-stub" />' },
}));

const rippleDeleteFirstSelectedItem = vi.fn();
const rippleDeleteSelectedClipRangeAllTracks = vi.fn();
const rippleTrimLeft = vi.fn();
const rippleTrimRight = vi.fn();
const copySelectedClips = vi.fn(() => []);
const cutSelectedClips = vi.fn(() => []);
const splitClipAtPlayhead = vi.fn();

const mockTimelineStore = reactive({
  timelineDoc: {
    tracks: [
      {
        id: 'track-1',
        kind: 'video',
        items: [
          {
            id: 'clip-1',
            kind: 'clip',
            clipType: 'media',
            locked: false,
            disabled: false,
            audioMuted: false,
            timelineRange: { startTicks: 1000000, durationTicks: 5000000 },
          },
        ],
      },
    ],
  },
  rippleDeleteFirstSelectedItem,
  rippleDeleteSelectedClipRangeAllTracks,
  rippleTrimLeft,
  rippleTrimRight,
  copySelectedClips,
  cutSelectedClips,
  splitClipAtPlayhead,
});

const mockSelectionStore = reactive({
  selectedEntity: {
    source: 'timeline',
    kind: 'clip',
    itemId: 'clip-1',
    trackId: 'track-1',
  },
});

const mockAppClipboard = reactive({
  setClipboardPayload: vi.fn(),
});

const mockWorkspaceStore = reactive({
  userSettings: {
    deleteWithoutConfirmation: true,
  },
  workspaceState: {
    fileBrowser: {
      instances: {
        'timeline-properties': {
          currentFolder: '',
          selectedPaths: [],
          expandedFolders: [],
        },
      },
    },
  },
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => mockAppClipboard,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({ isReadOnly: false }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('MobileClipPropertiesDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.timelineDoc.tracks[0].items[0].locked = false;
  });

  it('renders toolbar buttons and emits requests for dedicated action drawers', async () => {
    const wrapper = await mountSuspended(MobileClipPropertiesDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          MobileTimelineDrawer: {
            template: '<div><slot name="toolbar" /><slot /></div>',
          },
          MobileDrawerToolbar: {
            template: '<div class="toolbar-stub"><slot /></div>',
          },
          MobileDrawerToolbarButton: {
            props: {
              icon: String,
              active: Boolean,
              disabled: Boolean,
              withChevron: Boolean,
            },
            emits: ['click', 'chevron'],
            template:
              '<button :data-icon="icon" :class="{ active }" :disabled="disabled" @click="$emit(\'click\')"></button><button v-if="withChevron" data-chevron @click="$emit(\'chevron\')"></button>',
          },
          ClipProperties: {
            template: '<div />',
          },
        },
      },
    });

    // 9 toolbar entries; two of them (delete + blade) carry a variants chevron.
    const buttons = wrapper.findAll('.toolbar-stub button');
    expect(buttons.length).toBe(11);

    const deleteBtn = wrapper.find('button[data-icon="i-heroicons-trash"]');
    const trimBtn = wrapper.find('button[data-icon="i-heroicons-arrows-right-left"]');
    const splitBtn = wrapper.find('button[data-icon="i-lucide-lab-razor-blade"]');
    const transitionsBtn = wrapper.find('button[data-icon="i-lucide-blend"]');
    expect(deleteBtn.exists()).toBe(true);
    expect(trimBtn.exists()).toBe(true);
    expect(splitBtn.exists()).toBe(true);
    expect(transitionsBtn.exists()).toBe(true);

    // Primary delete tap performs a ripple delete (and closes the drawer); the
    // variants drawer opens from the corner chevron.
    await deleteBtn.trigger('click');
    expect(rippleDeleteFirstSelectedItem).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('open-delete-drawer')).toBeUndefined();

    const chevronButtons = wrapper.findAll('button[data-chevron]');
    expect(chevronButtons.length).toBe(2);

    // First chevron belongs to delete → opens delete drawer.
    await chevronButtons[0].trigger('click');
    expect(wrapper.emitted('open-delete-drawer')).toBeTruthy();

    // Second chevron belongs to blade/split → opens trim options drawer.
    await chevronButtons[1].trigger('click');
    expect(wrapper.emitted('open-trim-options-drawer')).toBeTruthy();

    await trimBtn.trigger('click');
    expect(wrapper.emitted('open-trim-drawer')).toBeTruthy();

    await transitionsBtn.trigger('click');
    expect(wrapper.emitted('open-transitions-drawer')).toBeTruthy();
  });

  it('does not emit a delete drawer request for a locked clip', async () => {
    mockTimelineStore.timelineDoc.tracks[0].items[0].locked = true;

    const wrapper = await mountSuspended(MobileClipPropertiesDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          MobileTimelineDrawer: {
            template: '<div><slot name="toolbar" /><slot /></div>',
          },
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: {
            props: ['icon', 'disabled'],
            emits: ['click'],
            template:
              '<button :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')"></button>',
          },
          ClipProperties: { template: '<div />' },
        },
      },
    });

    const deleteBtn = wrapper.find('button[data-icon="i-heroicons-trash"]');
    expect(deleteBtn.attributes('disabled')).toBeDefined();
    await deleteBtn.trigger('click');
    expect(wrapper.emitted('open-delete-drawer')).toBeUndefined();
  });

  it('calls splitClipAtPlayhead when split button is clicked', async () => {
    const wrapper = await mountSuspended(MobileClipPropertiesDrawer, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          MobileTimelineDrawer: {
            template: '<div><slot name="toolbar" /><slot /></div>',
          },
          MobileDrawerToolbar: {
            template: '<div><slot /></div>',
          },
          MobileDrawerToolbarButton: {
            props: ['icon', 'disabled'],
            emits: ['click'],
            template:
              '<button :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')"></button>',
          },
          ClipProperties: {
            template: '<div />',
          },
          UButton: true,
          UIcon: {
            template: '<span />',
          },
        },
      },
    });

    const splitBtn = wrapper.find('button[data-icon="i-lucide-lab-razor-blade"]');
    expect(splitBtn.exists()).toBe(true);
    expect(splitBtn.attributes('disabled')).toBeUndefined();
    await splitBtn.trigger('click');
    expect(splitClipAtPlayhead).toHaveBeenCalled();
  });
});
