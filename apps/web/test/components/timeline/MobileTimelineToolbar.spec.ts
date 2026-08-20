import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import MobileTimelineToolbar from '~/components/timeline/MobileTimelineToolbar.vue';

const mockTimelineStore = reactive({
  historyStore: {
    canUndo: vi.fn(() => true),
    canRedo: vi.fn(() => true),
  },
  undoTimeline: vi.fn(),
  redoTimeline: vi.fn(),
});

const mockSettingsStore = reactive({
  toolbarSnapMode: 'snap',
  toolbarDragModeEnabled: false,
  toolbarDragMode: 'pseudo_overlap',
  selectToolbarDragMode: vi.fn(),
  selectToolbarSnapMode: vi.fn(),
  setGlobalSnapThresholdPx: vi.fn(),
  toggleToolbarSnapMode: vi.fn(),
});

const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: {
      snapThresholdPx: 8,
      snapping: {
        timelineEdges: true,
        clips: true,
        markers: true,
        selection: true,
        playhead: true,
        playheadClick: true,
      },
    },
  },
});

const mockClipboardStore = reactive({
  hasTimelinePayload: false,
  clipboardPayload: null,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => mockSettingsStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => mockClipboardStore,
}));

describe('MobileTimelineToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render a split button', async () => {
    const wrapper = await mountSuspended(MobileTimelineToolbar, {
      global: {
        stubs: {
          MobileDrawerToolbar: {
            template: '<div class="mobile-drawer-toolbar-stub"><slot /></div>',
          },
          UiActionButton: {
            props: ['icon'],
            template: '<button :data-icon="icon" />',
          },
          UiSliderInput: true,
          UiMobileDrawer: true,
          UCheckbox: true,
          UIcon: {
            template: '<span />',
          },
        },
      },
    });

    const buttons = wrapper.findAll('button');
    const splitBtn = buttons.find((b) => b.attributes('data-icon')?.includes('scissors'));
    expect(splitBtn).toBeUndefined();
  });

  it('toggles toolbar snap mode on short snap button press', async () => {
    const wrapper = await mountSuspended(MobileTimelineToolbar, {
      global: {
        stubs: {
          MobileDrawerToolbar: {
            template: '<div class="mobile-drawer-toolbar-stub"><slot /></div>',
          },
          UiActionButton: {
            props: ['icon'],
            template: '<button :data-icon="icon" />',
          },
          UiSliderInput: true,
          UiMobileDrawer: true,
          UCheckbox: true,
          UIcon: {
            template: '<span />',
          },
        },
      },
    });

    const buttons = wrapper.findAll('button');
    const snapBtn = buttons.find((b) => b.attributes('data-icon')?.includes('link'));
    expect(snapBtn).toBeDefined();
    await snapBtn!.trigger('click');
    expect(mockSettingsStore.toggleToolbarSnapMode).toHaveBeenCalled();
  });
});
