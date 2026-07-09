import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, nextTick, ref, computed } from 'vue';
import SettingsStorage from '~/components/settings/SettingsStorage.vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

const dialogOpenMock = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => dialogOpenMock(...args),
}));

// `useStoragePersistence` reads `navigator.storage` at call time. We mock the
// composable directly, returning real refs so the component's `.value`
// accesses behave as in production. Each test mutates these refs to drive
// the browser-storage branch without depending on a real Storage API.
const storageIsPersisted = ref(false);
const storageIsSupported = ref(false);
const storageUsageBytes = ref<number | null>(null);
const storageQuotaBytes = ref<number | null>(null);
const refreshMock = vi.fn().mockResolvedValue(undefined);
const requestPersistMock = vi.fn().mockResolvedValue(undefined);

vi.mock('~/composables/useStoragePersistence', () => ({
  useStoragePersistence: () => ({
    isSupported: storageIsSupported,
    isPersisted: storageIsPersisted,
    usageBytes: storageUsageBytes,
    quotaBytes: storageQuotaBytes,
    usageRatio: computed(() =>
      storageUsageBytes.value == null || !storageQuotaBytes.value
        ? null
        : Math.min(1, storageUsageBytes.value / storageQuotaBytes.value),
    ),
    isRefreshing: ref(false),
    isRequesting: ref(false),
    refresh: refreshMock,
    requestPersist: requestPersistMock,
  }),
}));

const mockWorkspaceStore = reactive({
  workspaceProviderId: 'tauri',
  inDevelopmentFeaturesEnabled: true,
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
  appSettings: {
    paths: {
      contentRootPath: '',
      dataRootPath: '',
      tempRootPath: '',
      proxiesRootPath: '',
      ephemeralTmpRootPath: '',
      placementMode: 'system-default' as const,
    },
  },
  resolvedStorageTopology: {
    projectsRoot: '/data/projects',
    commonRoot: '/data/common',
    dataRoot: '/data',
    tempRoot: '/var/cache',
    proxiesRoot: '/data/proxies',
    ephemeralTmpRoot: '/tmp',
  },
  // Consumed by file-manager store computed during app init.
  workspaceState: {
    fileBrowser: { instances: {}, activeTab: 'computer' },
    ui: {},
  },
  tauriAppPaths: null as { configDir: string } | null,
  clearVardata: vi.fn().mockResolvedValue(undefined),
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

function resetStore() {
  mockWorkspaceStore.workspaceProviderId = 'tauri';
  mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
  Object.assign(mockWorkspaceStore.appSettings.paths, {
    contentRootPath: '',
    dataRootPath: '',
    tempRootPath: '',
    proxiesRootPath: '',
    ephemeralTmpRootPath: '',
    placementMode: 'system-default',
  });
  mockWorkspaceStore.tauriAppPaths = null;
  storageIsSupported.value = false;
  storageIsPersisted.value = false;
  storageUsageBytes.value = null;
  storageQuotaBytes.value = null;
}

describe('SettingsStorage.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('renders desktop path fields with topology placeholders in tauri mode', async () => {
    const wrapper = await mountSuspended(SettingsStorage);

    expect(wrapper.text()).toContain('videoEditor.settings.workspaceStorage');

    const inputs = wrapper.findAll('input');
    const placeholders = inputs.map((i) => i.attributes('placeholder'));
    expect(placeholders).toContain('/data/common');
    expect(placeholders).toContain('/data/projects');
    expect(placeholders).toContain('/data/proxies');
  });

  it('hides the content root field when inDevelopmentFeaturesEnabled is false', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;

    const wrapper = await mountSuspended(SettingsStorage);

    expect(wrapper.text()).not.toContain('videoEditor.settings.commonFilesFolder');
    expect(wrapper.text()).toContain('videoEditor.settings.defaultProjectsFolder');
  });

  it('trims and writes the data root path on input', async () => {
    const wrapper = await mountSuspended(SettingsStorage);

    // The default-projects input is the first text input in tauri mode when
    // dev features are on (content comes first). Use the one bound to dataRoot.
    const dataInput = wrapper
      .findAll('input')
      .find((i) => i.attributes('placeholder') === '/data/projects');
    expect(dataInput).toBeDefined();

    await dataInput!.setValue('  /home/me/projects  ');
    await nextTick();

    expect(mockWorkspaceStore.appSettings.paths.dataRootPath).toBe('/home/me/projects');
  });

  it('updates dataRootPath when the folder picker selects a path', async () => {
    dialogOpenMock.mockResolvedValue('/picked/data');

    const wrapper = await mountSuspended(SettingsStorage);

    await (wrapper.vm as any).pickDesktopPath('data');
    await nextTick();

    expect(dialogOpenMock).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(mockWorkspaceStore.appSettings.paths.dataRootPath).toBe('/picked/data');
  });

  it('does not change the store when the folder picker returns null', async () => {
    dialogOpenMock.mockResolvedValue(null);

    const wrapper = await mountSuspended(SettingsStorage);

    await (wrapper.vm as any).pickDesktopPath('data');
    await nextTick();

    expect(mockWorkspaceStore.appSettings.paths.dataRootPath).toBe('');
  });

  it('does nothing outside tauri runtime', async () => {
    mockWorkspaceStore.workspaceProviderId = 'web';
    dialogOpenMock.mockResolvedValue('/picked');

    const wrapper = await mountSuspended(SettingsStorage);

    await (wrapper.vm as any).pickDesktopPath('data');
    await nextTick();

    expect(dialogOpenMock).not.toHaveBeenCalled();
    expect(mockWorkspaceStore.appSettings.paths.dataRootPath).toBe('');
  });

  it('opens the confirm modal and clears vardata on confirm', async () => {
    const wrapper = await mountSuspended(SettingsStorage);

    const clearButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('videoEditor.settings.clearTempWorkspaceAction'));
    expect(clearButton).toBeDefined();
    await clearButton!.trigger('click');
    await nextTick();

    const modal = wrapper.findComponent({ name: 'UiConfirmModal' });
    expect(modal.exists()).toBe(true);
    await modal.vm.$emit('confirm');
    await nextTick();

    expect(mockWorkspaceStore.clearVardata).toHaveBeenCalledTimes(1);
  });

  it('renders the browser storage block with a request-persist button when not persisted', async () => {
    mockWorkspaceStore.workspaceProviderId = 'web';
    storageIsSupported.value = true;
    storageIsPersisted.value = false;

    const wrapper = await mountSuspended(SettingsStorage);

    expect(wrapper.text()).toContain('videoEditor.settings.browserStorage.title');
    expect(wrapper.text()).toContain('videoEditor.settings.browserStorage.requestPersist');
  });

  it('hides the request-persist button when already persisted', async () => {
    mockWorkspaceStore.workspaceProviderId = 'web';
    storageIsSupported.value = true;
    storageIsPersisted.value = true;

    const wrapper = await mountSuspended(SettingsStorage);

    expect(wrapper.text()).toContain('videoEditor.settings.browserStorage.persistedOn');
    expect(wrapper.text()).not.toContain('videoEditor.settings.browserStorage.requestPersist');
  });
});
