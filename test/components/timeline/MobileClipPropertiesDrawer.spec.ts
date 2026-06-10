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
  });

  it('renders correct toolbar buttons and toggles overlays', async () => {
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
            template: '<button :data-icon="icon" :class="{ active }" :disabled="disabled" @click="$emit(\'click\')"></button>',
          },
          ClipProperties: {
            template: '<div />',
          },
          UiRenameModal: true,
          UButton: {
            props: ['variant', 'color', 'size', 'icon'],
            emits: ['click'],
            template: '<button class="u-button" @click="$emit(\'click\')"><slot /></button>',
          },
          UIcon: {
            template: '<span />',
          },
        },
      },
    });

    const buttons = wrapper.findAll('.toolbar-stub button');
    // We expect: Delete Toggle, Trim Toggle, Active, Mute, Lock, Copy, Cut, Split, Rename
    expect(buttons.length).toBe(9);

    const deleteBtn = buttons[0];
    const trimBtn = buttons[1];
    expect(deleteBtn?.attributes('data-icon')).toBe('i-heroicons-trash');
    expect(trimBtn?.attributes('data-icon')).toBe('i-heroicons-arrows-right-left');
    expect(buttons[7]?.attributes('data-icon')).toBe('i-lucide-scissors');

    // Overlays should not be visible initially
    expect(wrapper.findAll('.u-button').length).toBe(0);

    // Click Delete button to open Delete overlay
    await deleteBtn?.trigger('click');
    expect(deleteBtn?.classes()).toContain('active');
    
    const uButtons = wrapper.findAll('.u-button');
    expect(uButtons.length).toBeGreaterThan(0);
    // Find the extract range button
    const extractBtn = uButtons.find(b => b.text().includes('fastcat.timeline.extractRange'));
    expect(extractBtn).toBeDefined();

    // Click Trim button to open Trim overlay (should close Delete overlay)
    await trimBtn?.trigger('click');
    expect(deleteBtn?.classes()).not.toContain('active');
    expect(trimBtn?.classes()).toContain('active');
  });

  it('calls correct store/action methods when overlay buttons are clicked', async () => {
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
            props: ['icon'],
            emits: ['click'],
            template: '<button :data-icon="icon" @click="$emit(\'click\')"></button>',
          },
          ClipProperties: {
            template: '<div />',
          },
          UiRenameModal: true,
          UButton: {
            props: ['variant', 'color', 'size', 'icon'],
            emits: ['click'],
            template: '<button class="u-button" @click="$emit(\'click\')"><slot /></button>',
          },
          UIcon: {
            template: '<span />',
          },
        },
      },
    });

    const deleteBtn = wrapper.find('button[data-icon="i-heroicons-trash"]');
    await deleteBtn.trigger('click');

    const uButtons = wrapper.findAll('.u-button');
    const liftBtn = uButtons.find(b => b.text().includes('fastcat.timeline.deleteLift'));
    expect(liftBtn).toBeDefined();
    await liftBtn!.trigger('click');
    expect(handleDeleteClip).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeTruthy();
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
            template: '<button :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')"></button>',
          },
          ClipProperties: {
            template: '<div />',
          },
          UiRenameModal: true,
          UButton: true,
          UIcon: {
            template: '<span />',
          },
        },
      },
    });

    const splitBtn = wrapper.find('button[data-icon="i-lucide-scissors"]');
    expect(splitBtn.exists()).toBe(true);
    expect(splitBtn.attributes('disabled')).toBeUndefined();
    await splitBtn.trigger('click');
    expect(splitClipAtPlayhead).toHaveBeenCalled();
  });
});
