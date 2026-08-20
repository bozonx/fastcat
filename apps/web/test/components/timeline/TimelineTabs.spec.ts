import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { reactive, ref, nextTick } from 'vue';
import TimelineTabs from '~/components/timeline/TimelineTabs.vue';

// Mock VueDraggable
vi.mock('vue-draggable-plus', () => ({
  VueDraggable: {
    name: 'VueDraggable',
    template: '<div><slot /></div>',
    props: ['modelValue'],
  },
}));

// Mock project store
const currentTimelinePathRef = ref('t1.otio');
const projectSettingsRef = ref({
  timelines: {
    openPaths: ['t1.otio', 't2.otio'],
  },
});

const mockProjectStore = {
  currentTimelinePath: currentTimelinePathRef,
  projectSettings: projectSettingsRef,
  closeTimelineFile: vi.fn(),
  closeOtherTimelineFiles: vi.fn(),
  closeAllTimelineFiles: vi.fn(),
  reorderTimelines: vi.fn(),
};

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return {
    ...original,
    storeToRefs: (store: any) => ({
      currentTimelinePath: store.currentTimelinePath,
      projectSettings: store.projectSettings,
    }),
  };
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

// Mock timeline store
const mockTimelineStore = reactive({
  isPathDirty: vi.fn((path) => path === 't2.otio'), // t2 is dirty
  saveTimeline: vi.fn(),
  deleteTimelineAutosaveFile: vi.fn(),
  skipRecoveryDialog: false,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

// Mock project actions
const mockLoadTimeline = vi.fn();
vi.mock('~/composables/editor/useProjectActions', () => ({
  useProjectActions: () => ({
    loadTimeline: mockLoadTimeline,
  }),
}));

// Mock hotkeys label helper
vi.mock('~/composables/useHotkeyLabel', () => ({
  useHotkeyLabel: () => ({
    getHotkeyTitle: vi.fn((path) => path),
  }),
}));

describe('TimelineTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentTimelinePathRef.value = 't1.otio';
    projectSettingsRef.value.timelines.openPaths = ['t1.otio', 't2.otio'];
    mockTimelineStore.isPathDirty.mockImplementation((path) => path === 't2.otio');
  });

  it('renders open tabs correctly', async () => {
    const wrapper = await mountSuspended(TimelineTabs);
    expect(wrapper.exists()).toBe(true);

    const tabs = wrapper.findAll('[data-path]');
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.text().toLowerCase()).toContain('t1');
    expect(tabs[1]?.text().toLowerCase()).toContain('t2');
  });

  it('closes a clean tab immediately', async () => {
    const wrapper = await mountSuspended(TimelineTabs);
    const tabs = wrapper.findAll('[data-path]');

    // Close t1.otio (clean)
    const closeBtn = tabs[0]?.find('.tab-close-btn');
    expect(closeBtn?.exists()).toBe(true);
    await closeBtn?.trigger('click');

    expect(mockProjectStore.closeTimelineFile).toHaveBeenCalledWith('t1.otio');
    // Confirm modal should not be open
    const confirmModal = wrapper.findComponent({ name: 'UiConfirmModal' });
    expect(confirmModal.props('open')).toBe(false);
  });

  it('opens confirm modal when closing a dirty tab', async () => {
    const wrapper = await mountSuspended(TimelineTabs);
    const tabs = wrapper.findAll('[data-path]');

    // Close t2.otio (dirty)
    const closeBtn = tabs[1]?.find('.tab-close-btn');
    await closeBtn?.trigger('click');

    // Confirm modal should be open
    const confirmModal = wrapper.findComponent({ name: 'UiConfirmModal' });
    expect(confirmModal.props('open')).toBe(true);
    expect(confirmModal.props('title')).toBe('videoEditor.timeline.closeUnsavedTitle');
    expect(confirmModal.props('description')).toBe('videoEditor.timeline.closeUnsavedMessage');

    expect(mockProjectStore.closeTimelineFile).not.toHaveBeenCalled();
  });

  it('saves changes and closes when confirming', async () => {
    const wrapper = await mountSuspended(TimelineTabs);
    const tabs = wrapper.findAll('[data-path]');

    // Close t2.otio (dirty, not active)
    const closeBtn = tabs[1]?.find('.tab-close-btn');
    await closeBtn?.trigger('click');

    const confirmModal = wrapper.findComponent({ name: 'UiConfirmModal' });

    // Trigger save (confirm)
    confirmModal.vm.$emit('confirm');
    await flushPromises();

    // Since t2.otio is not active, it should be loaded first, then saved, then closed
    expect(mockLoadTimeline).toHaveBeenCalledWith('t2.otio');
    expect(mockTimelineStore.saveTimeline).toHaveBeenCalled();
    expect(mockProjectStore.closeTimelineFile).toHaveBeenCalledWith('t2.otio');
    expect(confirmModal.props('open')).toBe(false);
    expect(mockTimelineStore.skipRecoveryDialog).toBe(false);
  });

  it('discards changes and closes when choosing discard option', async () => {
    const wrapper = await mountSuspended(TimelineTabs);
    const tabs = wrapper.findAll('[data-path]');

    // Close t2.otio (dirty)
    const closeBtn = tabs[1]?.find('.tab-close-btn');
    await closeBtn?.trigger('click');

    const confirmModal = wrapper.findComponent({ name: 'UiConfirmModal' });

    // Trigger discard (secondary)
    confirmModal.vm.$emit('secondary');
    await flushPromises();

    // Autosave file should be deleted, and tab closed without loading or saving
    expect(mockTimelineStore.deleteTimelineAutosaveFile).toHaveBeenCalledWith('t2.otio');
    expect(mockLoadTimeline).not.toHaveBeenCalled();
    expect(mockTimelineStore.saveTimeline).not.toHaveBeenCalled();
    expect(mockProjectStore.closeTimelineFile).toHaveBeenCalledWith('t2.otio');
    expect(confirmModal.props('open')).toBe(false);
    expect(mockTimelineStore.skipRecoveryDialog).toBe(false);
  });
});
