import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EditorHeader from '~/components/editor/EditorHeader.vue';

const mockProjectStore = reactive({
  currentProjectName: 'My Awesome Project',
  currentView: 'cut',
  goToFiles: vi.fn(),
  goToCut: vi.fn(),
  goToSound: vi.fn(),
  goToExport: vi.fn(),
});

const mockTimelineStore = reactive({
  historyStore: {
    canUndo: () => true,
    canRedo: () => true,
  },
  undoTimeline: vi.fn(),
  redoTimeline: vi.fn(),
  isSavingTimeline: false,
  isTimelineDirty: false,
  timelineDoc: {},
  saveTimeline: vi.fn(),
});

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: true,
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/composables/useHotkeyLabel', () => ({
  useHotkeyLabel: () => ({
    getHotkeyTitle: (label: string) => label,
  }),
}));

vi.mock('~/composables/useDropdownMenuFocus', () => ({
  dropdownNoReturnFocus: {},
}));

// Mock components to simplify mounting
vi.mock('~/components/timeline/TimelineTabs.vue', () => ({
  default: { name: 'TimelineTabs', template: '<div class="timeline-tabs-mock"></div>' },
}));
vi.mock('~/components/file-manager/BackgroundTasksButton.vue', () => ({
  default: { name: 'BackgroundTasksButton', template: '<div class="background-tasks-mock"></div>' },
}));

describe('EditorHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineStore.isSavingTimeline = false;
    mockTimelineStore.isTimelineDirty = false;
    mockTimelineStore.timelineDoc = {};
  });

  it('renders project name and emits open-project-settings when clicked', async () => {
    const wrapper = await mountSuspended(EditorHeader);

    const projectNameSpan = wrapper.find('[title="My Awesome Project"]');
    expect(projectNameSpan.exists()).toBe(true);
    expect(projectNameSpan.text()).toBe('My Awesome Project');

    await projectNameSpan.trigger('click');
    expect(wrapper.emitted('open-project-settings')).toBeTruthy();
  });

  it('renders project settings button in toolbar and emits open-project-settings when clicked', async () => {
    const wrapper = await mountSuspended(EditorHeader);

    // Find the settings button in the toolbar (it uses 'ix:project-configuration' icon)
    const settingsBtn = wrapper.find('[icon="ix:project-configuration"]');
    expect(settingsBtn.exists()).toBe(true);

    await settingsBtn.trigger('click');
    expect(wrapper.emitted('open-project-settings')).toBeTruthy();
  });

  it('renders save button in toolbar and calls timelineStore.saveTimeline when clicked', async () => {
    const wrapper = await mountSuspended(EditorHeader);

    // Save button should have save icon
    const saveBtn = wrapper.find('[icon="i-lucide-save"]');
    expect(saveBtn.exists()).toBe(true);

    await saveBtn.trigger('click');
    expect(mockTimelineStore.saveTimeline).toHaveBeenCalled();
  });

  it('shows spin animation and path icon on save button when saving', async () => {
    mockTimelineStore.isSavingTimeline = true;
    const wrapper = await mountSuspended(EditorHeader);

    const saveBtn = wrapper.find('[icon="i-heroicons-arrow-path"]');
    expect(saveBtn.exists()).toBe(true);
    expect(saveBtn.classes()).toContain('animate-spin');
  });
});
