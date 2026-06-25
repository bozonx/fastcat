import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import ProjectReadOnlyBanner from '~/components/editor/ProjectReadOnlyBanner.vue';

vi.mock('~/utils/dev-logger', () => ({
  createDevLogger: () => ({ log: vi.fn(), error: vi.fn() }),
}));

const mockProjectStore = reactive({
  isReadOnly: false,
  currentProjectName: null as string | null,
  currentProjectId: null as string | null,
  stealProjectLock: vi.fn(),
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

describe('ProjectReadOnlyBanner', () => {
  it('does not render when not read-only', async () => {
    mockProjectStore.isReadOnly = false;
    mockProjectStore.currentProjectName = 'Test';

    const component = await mountSuspended(ProjectReadOnlyBanner);

    expect(component.find('.bg-amber-500\\/10').exists()).toBe(false);
  });

  it('does not render when read-only but no project name', async () => {
    mockProjectStore.isReadOnly = true;
    mockProjectStore.currentProjectName = null;

    const component = await mountSuspended(ProjectReadOnlyBanner);

    expect(component.find('.bg-amber-500\\/10').exists()).toBe(false);
  });

  it('renders when read-only and project name is set', async () => {
    mockProjectStore.isReadOnly = true;
    mockProjectStore.currentProjectName = 'My Project';

    const component = await mountSuspended(ProjectReadOnlyBanner);

    expect(component.find('.bg-amber-500\\/10').exists()).toBe(true);
  });

  it('shows take control button', async () => {
    mockProjectStore.isReadOnly = true;
    mockProjectStore.currentProjectName = 'My Project';

    const component = await mountSuspended(ProjectReadOnlyBanner);

    expect(component.text()).toContain('videoEditor.project.takeControl');
  });

  it('calls stealProjectLock when take control is clicked', async () => {
    mockProjectStore.isReadOnly = true;
    mockProjectStore.currentProjectName = 'My Project';
    mockProjectStore.currentProjectId = 'proj-1';
    mockProjectStore.stealProjectLock = vi.fn().mockResolvedValue(undefined);

    const component = await mountSuspended(ProjectReadOnlyBanner);

    const button = component.find('button');
    await button.trigger('click');

    expect(mockProjectStore.stealProjectLock).toHaveBeenCalled();
  });
});
