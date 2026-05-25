import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';

const mockWorkspaceStore = reactive({
  workspaceProviderId: 'web',
  isApiSupported: true,
  isLoading: false,
  error: '',
  openWorkspace: vi.fn(),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.workspaceProviderId = 'web';
    mockWorkspaceStore.isApiSupported = true;
    mockWorkspaceStore.isLoading = false;
    mockWorkspaceStore.error = '';
  });

  it('renders welcome screen with title', async () => {
    const component = await mountSuspended(WelcomeScreen);

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('FastCat Video Editor');
  });

  it('shows web workspace message by default', async () => {
    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain(
      'Select a workspace folder on your computer. Your browser will ask for access to store project files, media proxies, and cache.',
    );
  });

  it('shows tauri workspace message when provider is tauri', async () => {
    mockWorkspaceStore.workspaceProviderId = 'tauri';

    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain(
      'Select a workspace folder on your computer. FastCat Video Editor will store projects, source media, proxies, and cache in this folder.',
    );
  });

  it('shows open workspace button when API is supported', async () => {
    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('fastcat.welcome.openWorkspace');
  });

  it('shows unsupported message when API is not supported', async () => {
    mockWorkspaceStore.isApiSupported = false;

    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('Workspace selection is not supported in this environment');
  });

  it('calls openWorkspace when button is clicked', async () => {
    const component = await mountSuspended(WelcomeScreen);

    const button = component.find('button');
    await button.trigger('click');

    expect(mockWorkspaceStore.openWorkspace).toHaveBeenCalled();
  });

  it('shows loading state on button when isLoading is true', async () => {
    mockWorkspaceStore.isLoading = true;

    const component = await mountSuspended(WelcomeScreen);

    const button = component.find('button');
    expect(button.attributes('disabled')).toBeDefined();
  });

  it('displays error message when error exists', async () => {
    mockWorkspaceStore.error = 'Failed to open workspace';

    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('Failed to open workspace');
  });
});
