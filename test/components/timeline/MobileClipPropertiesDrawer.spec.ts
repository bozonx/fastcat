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
            timelineRange: { startUs: 1000000, durationUs: 5000000 },
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
            props: ['icon', 'active', 'disabled'],
            emits: ['click'],
            template:
              '<button :data-icon="icon" :class="{ active }" :disabled="disabled" @click="$emit(\'click\')"></button>',
          },
          ClipProperties: {
            template: '<div />',
          },
        },
      },
    });

    const buttons = wrapper.findAll('.toolbar-stub button');
    expect(buttons.length).toBe(8);

    const deleteBtn = buttons[0];
    const trimBtn = buttons[3];
    expect(deleteBtn?.attributes('data-icon')).toBe('i-heroicons-trash');
    expect(trimBtn?.attributes('data-icon')).toBe('i-heroicons-arrows-right-left');
    expect(buttons[4]?.attributes('data-icon')).toBe('i-lucide-lab-razor-blade');

    await deleteBtn?.trigger('click');
    expect(wrapper.emitted('open-delete-drawer')).toBeTruthy();

    await trimBtn?.trigger('click');
    expect(wrapper.emitted('open-trim-drawer')).toBeTruthy();
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
