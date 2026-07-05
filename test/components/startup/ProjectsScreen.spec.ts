import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import { useRouter } from '#app/composables/router';
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

const mockGoToCut = vi.hoisted(() => vi.fn());

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({
    goToCut: mockGoToCut,
  }),
}));

const commonStubs = {
  UIcon: true,
  UButton: { template: '<button><slot /></button>' },
  UiTooltip: true,
  ProjectThumbnail: true,
  FriendlyTime: true,
  UDropdownMenu: {
    name: 'UDropdownMenu',
    props: ['items'],
    template: '<div data-testid="project-menu"><slot /></div>',
  },
  UiModal: true,
  EditorSettingsModal: true,
};

describe('ProjectsScreen', () => {
  const mockPush = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.workspaceProviderId = 'web';
    mockWorkspaceStore.isLoading = false;
    mockWorkspaceStore.error = '';
    mockWorkspaceStore.projects = ['Project Alpha', 'Project Beta', 'Awesome Video'];
    mockWorkspaceStore.recentProjects = [
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
    ];

    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      go: vi.fn(),
      back: vi.fn(),
      afterEach: vi.fn(),
      beforeEach: vi.fn(),
      beforeResolve: vi.fn(),
    } as any);
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

  it('opens web projects by project name even when recent metadata has a projectPath', async () => {
    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    await component.findAll('.cursor-pointer')[0]!.trigger('click');

    expect(mockGoToCut).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/editor/Awesome%20Video');
  });

  it('opens Tauri projects by projectPath when available', async () => {
    mockWorkspaceStore.workspaceProviderId = 'tauri';

    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    await component.findAll('.cursor-pointer')[0]!.trigger('click');

    expect(mockPush).toHaveBeenCalledWith('/editor/fastcat-workspace%2Fprojects%2FAwesome%20Video');
  });

  it('uses remove-from-list action for external Tauri projects', async () => {
    mockWorkspaceStore.workspaceProviderId = 'tauri';
    mockWorkspaceStore.recentProjects = [
      {
        projectName: 'External Project',
        projectId: 'external-1',
        updatedAt: '2026-01-04T10:00:00Z',
        projectPath: '/external/External Project',
      },
    ];

    const component = await mountSuspended(ProjectsScreen, {
      global: {
        stubs: commonStubs,
      },
    });

    const menu = component.findComponent({ name: 'UDropdownMenu' });
    const labels = menu.props('items')[0].map((item: { label: string }) => item.label);

    expect(labels).toContain('fastcat.projects.removeFromList');
    expect(labels).not.toContain('common.delete');
  });
});
