/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { createWorkspaceSettingsModule } from '~/stores/workspace/workspaceSettings';

describe('createWorkspaceSettingsModule', () => {
  it('initializes with default settings', () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    expect(mod.userSettings.value).toBeDefined();
    expect(mod.appSettings.value).toBeDefined();
    expect(mod.workspaceSettings).toBe(mod.appSettings);
    expect(mod.isSavingUserSettings.value).toBe(false);
    expect(mod.isSavingAppSettings.value).toBe(false);
  });

  it('resetSettingsState restores defaults', () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    const originalUser = mod.userSettings.value;
    mod.userSettings.value = { ...mod.userSettings.value, hotkeys: { 'test': ['A'] } } as any;
    mod.resetSettingsState();
    expect(mod.userSettings.value).toEqual(originalUser);
  });

  it('loadUserSettingsFromDisk does nothing when repo is null', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await expect(mod.loadUserSettingsFromDisk()).resolves.not.toThrow();
  });

  it('loadAppSettingsFromDisk does nothing when repo is null', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await expect(mod.loadAppSettingsFromDisk()).resolves.not.toThrow();
  });

  it('loadUserSettingsFromDisk loads from repo', async () => {
    const mockRepo = {
      loadUserSettings: vi.fn().mockResolvedValue({ hotkeys: {} }),
      saveUserSettings: vi.fn(),
      loadAppSettings: vi.fn(),
      saveAppSettings: vi.fn(),
    };
    const settingsRepo = ref(mockRepo as any);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await mod.loadUserSettingsFromDisk();
    expect(mockRepo.loadUserSettings).toHaveBeenCalled();
  });

  it('loadAppSettingsFromDisk loads from repo', async () => {
    const mockRepo = {
      loadUserSettings: vi.fn(),
      saveUserSettings: vi.fn(),
      loadAppSettings: vi.fn().mockResolvedValue({}),
      saveAppSettings: vi.fn(),
    };
    const settingsRepo = ref(mockRepo as any);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await mod.loadAppSettingsFromDisk();
    expect(mockRepo.loadAppSettings).toHaveBeenCalled();
  });

  it('loadUserSettingsFromDisk handles errors gracefully', async () => {
    const mockRepo = {
      loadUserSettings: vi.fn().mockRejectedValue(new Error('disk error')),
      saveUserSettings: vi.fn(),
      loadAppSettings: vi.fn(),
      saveAppSettings: vi.fn(),
    };
    const settingsRepo = ref(mockRepo as any);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await expect(mod.loadUserSettingsFromDisk()).resolves.not.toThrow();
  });

  it('batchUpdateUserSettings updates via updater', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await mod.batchUpdateUserSettings((draft) => {
      draft.hotkeys = { 'test': ['B'] } as any;
    });
    expect(mod.userSettings.value.hotkeys).toEqual({ 'test': ['B'] });
  });

  it('batchUpdateAppSettings updates via updater', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await mod.batchUpdateAppSettings((draft) => {
      (draft as any).customField = 'test';
    });
    expect((mod.appSettings.value as any).customField).toBe('test');
  });

  it('batchUpdateWorkspaceSettings delegates to appSettings', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await mod.batchUpdateWorkspaceSettings((draft) => {
      (draft as any).workspaceField = 'value';
    });
    expect((mod.appSettings.value as any).workspaceField).toBe('value');
  });

  it('flushSettingsSaves does not throw when repo is null', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await expect(mod.flushSettingsSaves()).resolves.not.toThrow();
  });

  it('saveUserSettingsToDisk does not throw when repo is null', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await expect(mod.saveUserSettingsToDisk()).resolves.not.toThrow();
  });

  it('saveAppSettingsToDisk does not throw when repo is null', async () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    await expect(mod.saveAppSettingsToDisk()).resolves.not.toThrow();
  });

  it('workspaceSettings is alias of appSettings', () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    expect(mod.workspaceSettings).toBe(mod.appSettings);
  });

  it('isSavingWorkspaceSettings is alias of isSavingAppSettings', () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    expect(mod.isSavingWorkspaceSettings).toBe(mod.isSavingAppSettings);
  });

  it('workspaceSettingsSaveError is alias of appSettingsSaveError', () => {
    const settingsRepo = ref(null);
    const mod = createWorkspaceSettingsModule({ settingsRepo });
    expect(mod.workspaceSettingsSaveError).toBe(mod.appSettingsSaveError);
  });
});
