import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';

const mockWorkspaceStore = {
  workspaceProviderId: ref('web'),
  isApiSupported: ref(true),
  isLoading: ref(false),
  error: ref(''),
  openWorkspace: vi.fn(),
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.workspaceProviderId.value = 'web';
    mockWorkspaceStore.isApiSupported.value = true;
    mockWorkspaceStore.isLoading.value = false;
    mockWorkspaceStore.error.value = '';
  });

  it('renders welcome screen with title', async () => {
    const component = await mountSuspended(WelcomeScreen);

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('FastCat Video Editor');
  });

  it('shows web workspace message by default', async () => {
    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('fastcat.welcome.selectWebWorkspace');
  });

  it('shows tauri workspace message when provider is tauri', async () => {
    mockWorkspaceStore.workspaceProviderId.value = 'tauri';

    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('fastcat.welcome.selectTauriWorkspace');
  });

  it('shows open workspace button when API is supported', async () => {
    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('fastcat.welcome.openWorkspace');
  });

  it('shows unsupported message when API is not supported', async () => {
    mockWorkspaceStore.isApiSupported.value = false;

    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('fastcat.fileManager.unsupported');
  });

  it('calls openWorkspace when button is clicked', async () => {
    const component = await mountSuspended(WelcomeScreen);

    const button = component.find('button');
    await button.trigger('click');

    expect(mockWorkspaceStore.openWorkspace).toHaveBeenCalled();
  });

  it('shows loading state on button when isLoading is true', async () => {
    mockWorkspaceStore.isLoading.value = true;

    const component = await mountSuspended(WelcomeScreen);

    const button = component.find('button');
    expect(button.attributes('disabled')).toBeDefined();
  });

  it('displays error message when error exists', async () => {
    mockWorkspaceStore.error.value = 'Failed to open workspace';

    const component = await mountSuspended(WelcomeScreen);

    expect(component.text()).toContain('Failed to open workspace');
  });
});
