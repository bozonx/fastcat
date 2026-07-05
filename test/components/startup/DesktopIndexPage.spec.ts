import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { nextTick } from 'vue';
import { useRoute, useRouter } from '#app/composables/router';
import DesktopIndexPage from '~/pages/index.vue';

const mockResetProjectState = vi.hoisted(() => vi.fn());
const mockProjectStore = vi.hoisted(() => ({ currentProjectName: '' }));
const mockDevice = vi.hoisted(() => ({ isMobile: false }));
const mockReadLocalStorageString = vi.hoisted(() => vi.fn());
const mockWriteLocalStorageString = vi.hoisted(() => vi.fn());

mockNuxtImport('useDevice', () => () => mockDevice);

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

vi.mock('~/stores/ui/uiLocalStorage', () => ({
  STORAGE_KEYS: {
    APP: {
      ALREADY_LAUNCHED: 'fastcat:already-launched',
      PREFER_DESKTOP: 'fastcat:prefer-desktop',
    },
  },
  readLocalStorageString: mockReadLocalStorageString,
  writeLocalStorageString: mockWriteLocalStorageString,
}));

describe('desktop index page', () => {
  const mockReplace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.currentProjectName = '';
    mockDevice.isMobile = false;
    mockReadLocalStorageString.mockImplementation(() => null);

    vi.mocked(useRoute).mockReturnValue({
      path: '/',
      fullPath: '/',
      query: {},
      params: {},
      hash: '',
      meta: { layout: 'default' },
    } as any);
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      replace: mockReplace,
      go: vi.fn(),
      back: vi.fn(),
      afterEach: vi.fn(),
      beforeEach: vi.fn(),
      beforeResolve: vi.fn(),
    } as any);
  });

  it('renders the desktop projects screen', async () => {
    const component = await mountSuspended(DesktopIndexPage);

    expect(component.find('[data-testid="projects-screen"]').exists()).toBe(true);
  });

  it('does not reset project state when no project is open', async () => {
    await mountSuspended(DesktopIndexPage);

    expect(mockResetProjectState).not.toHaveBeenCalled();
  });

  it('resets project state when landing on root with an open project', async () => {
    mockProjectStore.currentProjectName = 'Open Project';

    await mountSuspended(DesktopIndexPage);

    expect(mockResetProjectState).toHaveBeenCalledTimes(1);
  });

  it('persists forced desktop mode from the route query', async () => {
    vi.mocked(useRoute).mockReturnValue({
      path: '/',
      fullPath: '/?mode=desktop',
      query: { mode: 'desktop' },
      params: {},
      hash: '',
      meta: { layout: 'default' },
    } as any);

    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockWriteLocalStorageString).toHaveBeenCalledWith('fastcat:prefer-desktop', 'true');
  });

  it('redirects mobile devices to mobile root unless desktop mode is preferred', async () => {
    mockDevice.isMobile = true;
    mockReadLocalStorageString.mockImplementation((key: string) =>
      key === 'fastcat:prefer-desktop' ? 'false' : null,
    );

    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockReplace).toHaveBeenCalledWith('/m');
  });

  it('does not redirect mobile devices when desktop mode is preferred', async () => {
    mockDevice.isMobile = true;
    mockReadLocalStorageString.mockImplementation((key: string) =>
      key === 'fastcat:prefer-desktop' ? 'true' : null,
    );

    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockReplace).not.toHaveBeenCalledWith('/m');
  });
});
