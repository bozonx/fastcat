import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ProjectsPage from '~/pages/projects/index.vue';

const mockResetProjectState = vi.hoisted(() => vi.fn());
const mockProjectStore = vi.hoisted(() => ({ currentProjectName: '' }));

vi.mock('~/components/startup/ProjectsScreen.vue', () => ({
  default: {
    name: 'ProjectsScreen',
    template: '<div data-testid="projects-screen" />',
  },
}));

vi.mock('~/composables/editor/useProjectActions', () => ({
  useProjectActions: () => ({
    resetProjectState: mockResetProjectState,
  }),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

describe('projects page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.currentProjectName = '';
  });

  it('renders the projects screen', async () => {
    const component = await mountSuspended(ProjectsPage);

    expect(component.find('[data-testid="projects-screen"]').exists()).toBe(true);
  });

  it('does not reset project state when no project is open', async () => {
    await mountSuspended(ProjectsPage);

    expect(mockResetProjectState).not.toHaveBeenCalled();
  });

  it('resets project state when landing with an open project', async () => {
    mockProjectStore.currentProjectName = 'Open Project';

    await mountSuspended(ProjectsPage);

    expect(mockResetProjectState).toHaveBeenCalledTimes(1);
  });
});
