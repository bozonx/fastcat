/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createWorkspaceInitModule } from '~/stores/workspace/workspaceInit';
import { getWorkspaceStorageTopology } from '~/utils/storage-roots';

function createMockProvider() {
  return {
    isSupported: true,
    openWorkspace: vi.fn(),
    restoreWorkspace: vi.fn(),
    clearWorkspace: vi.fn(),
  };
}

function createMockHandle(name: string) {
  const dirs = new Map<string, any>();
  return {
    name,
    kind: 'directory',
    async getDirectoryHandle(dirName: string, options?: { create?: boolean }) {
      if (!dirs.has(dirName) && options?.create) {
        dirs.set(dirName, createMockHandle(dirName));
      }
      return dirs.get(dirName);
    },
  };
}

describe('createWorkspaceInitModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setupWorkspace loads and saves workspace state', async () => {
    const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
    const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);
    const settingsRepo = ref<any>(null);
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const isInitializing = ref(true);
    const isEphemeral = ref(false);

    const loadProjects = vi.fn().mockResolvedValue(undefined);
    const loadAppSettingsFromDisk = vi.fn().mockResolvedValue(undefined);
    const loadWorkspaceSettingsFromDisk = vi.fn().mockResolvedValue(undefined);
    const loadUserSettingsFromDisk = vi.fn().mockResolvedValue(undefined);
    const loadWorkspaceStateFromDisk = vi.fn().mockResolvedValue(undefined);
    const saveAppSettingsToDisk = vi.fn().mockResolvedValue(undefined);
    const saveWorkspaceSettingsToDisk = vi.fn().mockResolvedValue(undefined);
    const saveUserSettingsToDisk = vi.fn().mockResolvedValue(undefined);
    const saveWorkspaceStateToDisk = vi.fn().mockResolvedValue(undefined);
    const resetSettingsState = vi.fn();

    const module = createWorkspaceInitModule({
      workspaceHandle,
      projectsHandle,
      settingsRepo,
      workspaceProvider: createMockProvider() as any,
      isLoading,
      error,
      isInitializing,
      isEphemeral,
      loadProjects,
      loadAppSettingsFromDisk,
      loadWorkspaceSettingsFromDisk,
      loadUserSettingsFromDisk,
      loadWorkspaceStateFromDisk,
      saveAppSettingsToDisk,
      saveWorkspaceSettingsToDisk,
      saveUserSettingsToDisk,
      saveWorkspaceStateToDisk,
      resetSettingsState,
    });

    const mockHandle = createMockHandle('test-workspace') as any;
    await module.setupWorkspace(mockHandle);

    expect(loadWorkspaceStateFromDisk).toHaveBeenCalledTimes(1);
    expect(saveWorkspaceStateToDisk).toHaveBeenCalledTimes(1);
    expect(loadProjects).toHaveBeenCalledTimes(1);
    expect(loadAppSettingsFromDisk).toHaveBeenCalledTimes(1);
    expect(loadUserSettingsFromDisk).toHaveBeenCalledTimes(1);
    expect(saveAppSettingsToDisk).toHaveBeenCalledTimes(1);
    expect(saveUserSettingsToDisk).toHaveBeenCalledTimes(1);
  });

  it('init restores workspace and calls setupWorkspace', async () => {
    const workspaceHandle = ref<FileSystemDirectoryHandle | null>(null);
    const projectsHandle = ref<FileSystemDirectoryHandle | null>(null);
    const settingsRepo = ref<any>(null);
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const isInitializing = ref(true);
    const isEphemeral = ref(false);

    const mockProvider = createMockProvider();
    const mockHandle = createMockHandle('restored-workspace');
    mockProvider.restoreWorkspace.mockResolvedValue(mockHandle);

    const loadProjects = vi.fn().mockResolvedValue(undefined);
    const loadAppSettingsFromDisk = vi.fn().mockResolvedValue(undefined);
    const loadWorkspaceSettingsFromDisk = vi.fn().mockResolvedValue(undefined);
    const loadUserSettingsFromDisk = vi.fn().mockResolvedValue(undefined);
    const loadWorkspaceStateFromDisk = vi.fn().mockResolvedValue(undefined);
    const saveAppSettingsToDisk = vi.fn().mockResolvedValue(undefined);
    const saveWorkspaceSettingsToDisk = vi.fn().mockResolvedValue(undefined);
    const saveUserSettingsToDisk = vi.fn().mockResolvedValue(undefined);
    const saveWorkspaceStateToDisk = vi.fn().mockResolvedValue(undefined);
    const resetSettingsState = vi.fn();

    const module = createWorkspaceInitModule({
      workspaceHandle,
      projectsHandle,
      settingsRepo,
      workspaceProvider: mockProvider as any,
      isLoading,
      error,
      isInitializing,
      isEphemeral,
      loadProjects,
      loadAppSettingsFromDisk,
      loadWorkspaceSettingsFromDisk,
      loadUserSettingsFromDisk,
      loadWorkspaceStateFromDisk,
      saveAppSettingsToDisk,
      saveWorkspaceSettingsToDisk,
      saveUserSettingsToDisk,
      saveWorkspaceStateToDisk,
      resetSettingsState,
    });

    await module.init();

    expect(mockProvider.restoreWorkspace).toHaveBeenCalledTimes(1);
    expect(loadWorkspaceStateFromDisk).toHaveBeenCalledTimes(1);
    expect(isInitializing.value).toBe(false);
  });
});
