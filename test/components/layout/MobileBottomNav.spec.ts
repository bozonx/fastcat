import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import MobileBottomNav from '~/components/layout/MobileBottomNav.vue';

const mockRoute = reactive({ path: '/m' });
const pushMock = vi.fn();
const leaveProjectMock = vi.fn(async () => {});

const mockWorkspaceStore = reactive({ lastProjectName: '' as string });
const mockFileManagerStore = reactive({ selectedFolder: { name: 'Root' } as unknown });

mockNuxtImport('useRoute', () => () => mockRoute);
mockNuxtImport('useRouter', () => () => ({
  push: pushMock,
  replace: vi.fn(),
  afterEach: vi.fn(),
  beforeEach: vi.fn(),
  onError: vi.fn(),
}));

vi.mock('~/composables/editor/useProjectActions', () => ({
  useProjectActions: () => ({ leaveProject: leaveProjectMock }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => mockFileManagerStore,
}));

describe('MobileBottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.path = '/m';
    mockWorkspaceStore.lastProjectName = '';
    mockFileManagerStore.selectedFolder = { name: 'Root' };
  });

  it('hides the nav on home when there is no last project', async () => {
    const wrapper = await mountSuspended(MobileBottomNav);
    expect(wrapper.find('nav').exists()).toBe(false);
  });

  it('shows the nav on home when a last project exists', async () => {
    mockWorkspaceStore.lastProjectName = 'My Project';
    const wrapper = await mountSuspended(MobileBottomNav);
    expect(wrapper.find('nav').exists()).toBe(true);
    expect(wrapper.findAll('button')).toHaveLength(5);
  });

  it('always shows the nav on the editor page', async () => {
    mockRoute.path = '/m/editor/proj';
    const wrapper = await mountSuspended(MobileBottomNav);
    expect(wrapper.find('nav').exists()).toBe(true);
  });

  it('navigates to home when the home button is tapped on the editor page', async () => {
    mockRoute.path = '/m/editor/proj';
    const wrapper = await mountSuspended(MobileBottomNav);

    await wrapper.findAll('button')[0]!.trigger('click');
    expect(leaveProjectMock).toHaveBeenCalledWith('/m');
  });

  it('pushes to the mobile root when the home button is tapped outside the editor', async () => {
    mockWorkspaceStore.lastProjectName = 'My Project';
    const wrapper = await mountSuspended(MobileBottomNav);

    await wrapper.findAll('button')[0]!.trigger('click');
    expect(pushMock).toHaveBeenCalledWith('/m');
  });

  it('emits active tab updates when a panel is tapped on the editor page', async () => {
    mockRoute.path = '/m/editor/proj';
    const wrapper = await mountSuspended(MobileBottomNav, {
      props: { activeTab: 'edit' },
    });

    // index 1 is the "files" tab
    await wrapper.findAll('button')[1]!.trigger('click');
    expect(wrapper.emitted('update:activeTab')?.[0]).toEqual(['files']);
  });

  it('clears the selected folder when re-tapping the active files tab', async () => {
    mockRoute.path = '/m/editor/proj';
    const wrapper = await mountSuspended(MobileBottomNav, {
      props: { activeTab: 'files' },
    });

    await wrapper.findAll('button')[1]!.trigger('click');
    expect(mockFileManagerStore.selectedFolder).toBeNull();
    expect(wrapper.emitted('update:activeTab')).toBeUndefined();
  });

  it('navigates to the editor with a view query when tapping a panel outside the editor', async () => {
    mockWorkspaceStore.lastProjectName = 'My Project';
    const wrapper = await mountSuspended(MobileBottomNav);

    await wrapper.findAll('button')[2]!.trigger('click');
    expect(pushMock).toHaveBeenCalledWith({
      path: '/m/editor/My%20Project',
      query: { view: 'edit' },
    });
  });
});
