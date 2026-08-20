import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { nextTick } from 'vue';
import { useRoute, useRouter } from '#app/composables/router';
import DesktopIndexPage from '~/pages/index.vue';

const mockWorkspaceStore = vi.hoisted(() => ({
  isInitializing: false,
  workspaceProviderId: 'web',
  userSettings: { openLastProjectOnStart: false },
  lastProjectName: null as string | null,
  lastProjectPath: null as string | null,
}));
const mockDevice = vi.hoisted(() => ({ isMobile: false }));

mockNuxtImport('useDevice', () => () => mockDevice);

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('desktop index page', () => {
  const mockReplace = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.isInitializing = false;
    mockWorkspaceStore.workspaceProviderId = 'web';
    mockWorkspaceStore.userSettings = { openLastProjectOnStart: false };
    mockWorkspaceStore.lastProjectName = null;
    mockWorkspaceStore.lastProjectPath = null;
    mockDevice.isMobile = false;

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

  it('redirects to /projects on desktop when no auto-open', async () => {
    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockReplace).toHaveBeenCalledWith('/projects');
  });

  it('redirects to /m on mobile', async () => {
    mockDevice.isMobile = true;

    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockReplace).toHaveBeenCalledWith('/m');
  });

  it('auto-opens last project on Tauri when setting is enabled', async () => {
    mockWorkspaceStore.workspaceProviderId = 'tauri';
    mockWorkspaceStore.userSettings = { openLastProjectOnStart: true };
    mockWorkspaceStore.lastProjectName = 'MyProject';
    mockWorkspaceStore.lastProjectPath = '/path/to/MyProject';

    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockReplace).toHaveBeenCalledWith('/editor/%2Fpath%2Fto%2FMyProject');
  });

  it('falls back to lastProjectName when lastProjectPath is null', async () => {
    mockWorkspaceStore.workspaceProviderId = 'tauri';
    mockWorkspaceStore.userSettings = { openLastProjectOnStart: true };
    mockWorkspaceStore.lastProjectName = 'MyProject';
    mockWorkspaceStore.lastProjectPath = null;

    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockReplace).toHaveBeenCalledWith('/editor/MyProject');
  });

  it('does not auto-open on web even with setting enabled', async () => {
    mockWorkspaceStore.workspaceProviderId = 'web';
    mockWorkspaceStore.userSettings = { openLastProjectOnStart: true };
    mockWorkspaceStore.lastProjectName = 'MyProject';

    await mountSuspended(DesktopIndexPage);
    await nextTick();

    expect(mockReplace).toHaveBeenCalledWith('/projects');
  });
});
