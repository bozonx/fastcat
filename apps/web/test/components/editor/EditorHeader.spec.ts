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
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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

  it('hides the save button in web desktop', async () => {
    const wrapper = await mountSuspended(EditorHeader);

    const saveBtn = wrapper.find('[icon="i-lucide-save"]');
    expect(saveBtn.exists()).toBe(false);
  });

  it('renders save button in native desktop and calls timelineStore.saveTimeline when clicked', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const wrapper = await mountSuspended(EditorHeader);

    const saveBtn = wrapper.find('[icon="i-lucide-save"]');
    expect(saveBtn.exists()).toBe(true);

    await saveBtn.trigger('click');
    expect(mockTimelineStore.saveTimeline).toHaveBeenCalled();
  });

  it('shows spin animation and path icon on native save button when saving', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mockTimelineStore.isSavingTimeline = true;
    const wrapper = await mountSuspended(EditorHeader);

    const saveBtn = wrapper.find('[icon="i-heroicons-arrow-path"]');
    expect(saveBtn.exists()).toBe(true);
    expect(saveBtn.classes()).toContain('animate-spin');
  });

  it('highlights native save button when timeline has unsaved changes', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    mockTimelineStore.isTimelineDirty = true;
    const wrapper = await mountSuspended(EditorHeader);

    const saveBtn = wrapper.find('[icon="i-lucide-save"]');
    expect(saveBtn.exists()).toBe(true);
    expect(saveBtn.classes()).toContain('text-selection-accent-500');
    expect(saveBtn.classes()).toContain('hover:text-selection-accent-400');
  });

  it('renders app settings button and emits open-editor-settings when clicked', async () => {
    const wrapper = await mountSuspended(EditorHeader);

    const settingsBtn = wrapper.find('[icon="i-heroicons-cog-6-tooth"]');
    expect(settingsBtn.exists()).toBe(true);

    await settingsBtn.trigger('click');
    expect(wrapper.emitted('open-editor-settings')).toBeTruthy();
  });

  it('renders BackgroundTasksButton when inDevelopmentFeaturesEnabled is true', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
    const wrapper = await mountSuspended(EditorHeader);

    const bgTasks = wrapper.findComponent({ name: 'BackgroundTasksButton' });
    expect(bgTasks.exists()).toBe(true);
  });

  it('does not render BackgroundTasksButton when inDevelopmentFeaturesEnabled is false', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    const wrapper = await mountSuspended(EditorHeader);

    const bgTasks = wrapper.findComponent({ name: 'BackgroundTasksButton' });
    expect(bgTasks.exists()).toBe(false);
  });
});
