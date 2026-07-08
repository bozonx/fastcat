import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { reactive, nextTick } from 'vue';
import IntegrationAccountSection from '~/components/settings/integrations/IntegrationAccountSection.vue';

const { getFastCatPublicadorConnectUrlMock, getFastCatPublicadorHealthUrlMock, resolveFastCatConnectScopesMock, runExternalHealthCheckMock } =
  vi.hoisted(() => ({
    getFastCatPublicadorConnectUrlMock: vi.fn(() => 'https://connect.example.com/oauth'),
    getFastCatPublicadorHealthUrlMock: vi.fn(() => 'https://api.example.com/health'),
    resolveFastCatConnectScopesMock: vi.fn(() => ['read']),
    runExternalHealthCheckMock: vi.fn(),
  }));

const mockIntegrations = reactive({
  fastcatAccount: { enabled: false, bearerToken: '' },
  fastcatPublicador: { enabled: false, bearerToken: '' },
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: { integrations: mockIntegrations },
  }),
}));

vi.mock('~/utils/external-integrations', () => ({
  getFastCatPublicadorConnectUrl: getFastCatPublicadorConnectUrlMock,
  getFastCatPublicadorHealthUrl: getFastCatPublicadorHealthUrlMock,
  resolveFastCatConnectScopes: resolveFastCatConnectScopesMock,
  runExternalHealthCheck: runExternalHealthCheckMock,
}));

vi.mock('~/utils/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/utils/constants')>();
  return { ...actual, FASTCAT_PUBLICADOR_APP_NAME: 'FastCat' };
});

mockNuxtImport('useRuntimeConfig', () => () => ({
  public: {
    fastcatAccountApiUrl: 'https://api.example.com',
    fastcatAccountUiUrl: 'https://app.example.com',
  },
}));

const windowOpenMock = vi.fn();
window.open = windowOpenMock;

const baseProps = {
  integrationKey: 'fastcatAccount' as const,
  title: 'Fastcat Account',
  hintKey: 'hint.key',
  connectActionKey: 'connect.key',
  apiUrlConfigKey: 'fastcatAccountApiUrl',
  uiUrlConfigKey: 'fastcatAccountUiUrl',
  target: 'fastcat',
  includeStt: true,
  missingConfigFallback: 'Missing config',
};

describe('IntegrationAccountSection', () => {
  const stubs = {
    UIcon: { props: ['name'], template: '<span class="icon-mock" />' },
    UButton: {
      props: ['color', 'variant', 'size', 'disabled', 'loading', 'icon', 'square'],
      emits: ['click'],
      template:
        '<button class="u-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
  };

  beforeEach(() => {
    mockIntegrations.fastcatAccount = { enabled: false, bearerToken: '' };
    mockIntegrations.fastcatPublicador = { enabled: false, bearerToken: '' };
    vi.clearAllMocks();
  });

  it('renders not-connected state when no bearer token', async () => {
    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    expect(component.text()).toContain('connect.key');
    expect(component.find('button.u-button[disabled]').exists()).toBe(false);
  });

  it('disables connect button when uiUrl is empty', async () => {
    const component = await mountSuspended(IntegrationAccountSection, {
      props: { ...baseProps, uiUrlConfigKey: 'nonExistentKey' },
      global: { stubs },
    });

    const connectBtn = component.findAll('button.u-button')[0]!;
    expect(connectBtn.attributes('disabled')).toBeDefined();
  });

  it('opens connect URL in new window when connect clicked', async () => {
    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    const connectBtn = component.findAll('button.u-button')[0]!;
    await connectBtn.trigger('click');

    expect(getFastCatPublicadorConnectUrlMock).toHaveBeenCalled();
    expect(windowOpenMock).toHaveBeenCalledWith('https://connect.example.com/oauth', '_blank');
  });

  it('renders connected state with disconnect button when bearer token present', async () => {
    mockIntegrations.fastcatAccount = { enabled: true, bearerToken: 'token-xyz' };
    runExternalHealthCheckMock.mockResolvedValue({ status: 200 });

    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    expect(component.text()).toContain('integrationBreakConnection');
  });

  it('disconnects: clears token and resets health on disconnect click', async () => {
    mockIntegrations.fastcatAccount = { enabled: true, bearerToken: 'token-xyz' };
    runExternalHealthCheckMock.mockResolvedValue({ status: 200 });

    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    const disconnectBtn = component.findAll('button.u-button').find((b) => b.text().includes('integrationBreakConnection'))!;
    await disconnectBtn.trigger('click');

    await nextTick();
    expect(mockIntegrations.fastcatAccount.bearerToken).toBe('');
    expect(mockIntegrations.fastcatAccount.enabled).toBe(false);
  });

  it('shows error when runHealth called with empty health url', async () => {
    // Token present so health auto-runs on mount, but health url empty → missing-config error
    mockIntegrations.fastcatAccount = { enabled: true, bearerToken: 'token-xyz' };
    getFastCatPublicadorHealthUrlMock.mockReturnValue('');
    runExternalHealthCheckMock.mockResolvedValue({ status: 200 });

    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    await nextTick();
    expect(runExternalHealthCheckMock).not.toHaveBeenCalled();
    expect(component.text()).toContain('integrationHealthMissingConfig');
  });

  it('runs health check successfully and shows success status', async () => {
    mockIntegrations.fastcatAccount = { enabled: true, bearerToken: 'token-xyz' };
    runExternalHealthCheckMock.mockResolvedValue({ status: 200 });
    getFastCatPublicadorHealthUrlMock.mockReturnValue('https://api.example.com/health');

    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    await nextTick();
    expect(runExternalHealthCheckMock).toHaveBeenCalled();
    expect(component.text()).toContain('integrationHealthOk');
  });

  it('shows error status when health check fails', async () => {
    mockIntegrations.fastcatAccount = { enabled: true, bearerToken: 'token-xyz' };
    runExternalHealthCheckMock.mockRejectedValue(new Error('Network down'));
    getFastCatPublicadorHealthUrlMock.mockReturnValue('https://api.example.com/health');

    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    await nextTick();
    await nextTick();
    expect(component.text()).toContain('Network down');
  });

  it('auto-runs health check on mount when token present', async () => {
    mockIntegrations.fastcatAccount = { enabled: true, bearerToken: 'token-xyz' };
    runExternalHealthCheckMock.mockResolvedValue({ status: 200 });
    getFastCatPublicadorHealthUrlMock.mockReturnValue('https://api.example.com/health');

    await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    expect(runExternalHealthCheckMock).toHaveBeenCalled();
  });

  it('renders manual link when uiUrl present', async () => {
    const component = await mountSuspended(IntegrationAccountSection, {
      props: baseProps,
      global: { stubs },
    });

    const link = component.find('a[href="https://app.example.com"]');
    expect(link.exists()).toBe(true);
  });
});
