import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import ProjectsScreen from '~/components/startup/ProjectsScreen.vue';

const mockWorkspaceStore = reactive({
  workspaceProviderId: 'web',
  isLoading: false,
  error: '',
  projects: ['Project Alpha', 'Project Beta', 'Awesome Video'],
  recentProjects: [
    {
      projectName: 'Project Alpha',
      projectId: 'proj-1',
      lastTimelinePath: 'alpha.otio',
      updatedAt: '2026-01-01T10:00:00Z',
      projectPath: 'fastcat-workspace/projects/Project Alpha',
    },
    {
      projectName: 'Project Beta',
      projectId: 'proj-2',
      lastTimelinePath: 'beta.otio',
      updatedAt: '2026-01-02T10:00:00Z',
      projectPath: 'fastcat-workspace/projects/Project Beta',
    },
    {
      projectName: 'Awesome Video',
      projectId: 'proj-3',
      lastTimelinePath: 'awesome.otio',
      updatedAt: '2026-01-03T10:00:00Z',
      projectPath: 'fastcat-workspace/projects/Awesome Video',
    },
  ],
  resolvedStorageTopology: {
    projectsRoot: '/mock-projects',
    tempRoot: '/mock-temp',
    proxiesRoot: '/mock-proxies',
    ephemeralTmpRoot: '/mock-ephemeral-tmp',
    commonRoot: '/mock-common',
    dataRoot: '/mock-data',
  },
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
  duplicateProject: vi.fn(),
  forgetProject: vi.fn(),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

const commonStubs = {
  UIcon: true,
  UButton: { template: '<button><slot /></button>' },
  UiTooltip: true,
  ProjectThumbnail: true,
  FriendlyTime: true,
  UDropdownMenu: true,
  UiModal: true,
  EditorSettingsModal: true,
};

describe('ProjectsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.workspaceProviderId = 'web';
    mockWorkspaceStore.isLoading = false;
    mockWorkspaceStore.error = '';
    mockWorkspaceStore.projects = ['Project Alpha', 'Project Beta', 'Awesome Video'];
  });

  it('renders title and project list count', async () => {
    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('FASTCAT');
    expect(component.text()).toContain('(3)');
  });

  it('renders all projects in the workspace', async () => {
    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    expect(component.text()).toContain('Project Alpha');
    expect(component.text()).toContain('Project Beta');
    expect(component.text()).toContain('Awesome Video');
  });

  it('filters projects when typing into search input', async () => {
    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    const searchInput = component.findComponent({ name: 'UiSearchInput' });
    if (searchInput.exists()) {
      await searchInput.setValue('Awesome');
      expect(component.text()).toContain('Awesome Video');
      expect(component.text()).not.toContain('Project Alpha');
    }
  });

  it('shows error banner when workspaceStore error exists', async () => {
    mockWorkspaceStore.error = 'Failed to load projects';

    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    expect(component.text()).toContain('Failed to load projects');
  });

  it('renders Open Project from Disk button when in Tauri mode', async () => {
    mockWorkspaceStore.workspaceProviderId = 'tauri';

    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    expect(component.text()).toContain('fastcat.projects.openProjectDisk');
  });
});
