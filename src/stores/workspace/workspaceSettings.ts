import { ref, watch, type Ref } from 'vue';

import { createAutoSave } from '~/utils/autoSave';
import { getErrorMessage } from '~/utils/errors';
import {
  type FastCatAppSettings,
  type FastCatUserSettings,
  type FastCatWorkspaceSettings,
  createDefaultAppSettings,
  createDefaultUserSettings,
  normalizeAppSettings,
  normalizeUserSettings,
} from '~/utils/settings';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';

export interface WorkspaceSettingsModule {
  userSettings: Ref<FastCatUserSettings>;
  appSettings: Ref<FastCatAppSettings>;
  workspaceSettings: Ref<FastCatWorkspaceSettings>;

  isSavingUserSettings: Ref<boolean>;
  userSettingsSaveError: Ref<string | null>;
  isSavingAppSettings: Ref<boolean>;
  appSettingsSaveError: Ref<string | null>;
  isSavingWorkspaceSettings: Ref<boolean>;
  workspaceSettingsSaveError: Ref<string | null>;

  batchUpdateUserSettings: (
    updater: (draft: FastCatUserSettings) => void,
    options?: { immediate?: boolean },
  ) => Promise<void>;
  batchUpdateAppSettings: (
    updater: (draft: FastCatAppSettings) => void,
    options?: { immediate?: boolean },
  ) => Promise<void>;
  batchUpdateWorkspaceSettings: (
    updater: (draft: FastCatWorkspaceSettings) => void,
    options?: { immediate?: boolean },
  ) => Promise<void>;

  loadAppSettingsFromDisk: () => Promise<void>;
  loadWorkspaceSettingsFromDisk: () => Promise<void>;
  loadUserSettingsFromDisk: () => Promise<void>;

  saveAppSettingsToDisk: () => Promise<void>;
  saveWorkspaceSettingsToDisk: () => Promise<void>;
  saveUserSettingsToDisk: () => Promise<void>;

  flushSettingsSaves: () => Promise<void>;

  resetSettingsState: () => void;
}

export function createWorkspaceSettingsModule(params: {
  settingsRepo: Ref<WorkspaceSettingsRepository | null>;
}): WorkspaceSettingsModule {
  const userSettings = ref<FastCatUserSettings>(createDefaultUserSettings());
  const appSettings = ref<FastCatAppSettings>(createDefaultAppSettings());
  const workspaceSettings = appSettings as Ref<FastCatWorkspaceSettings>;

  const isSavingUserSettings = ref(false);
  const userSettingsSaveError = ref<string | null>(null);
  const isBatchUpdatingUserSettings = ref(false);

  const autoSaveUserSettings = createAutoSave({
    doSave: async () => {
      if (!params.settingsRepo.value) return false;
      isSavingUserSettings.value = true;
      userSettingsSaveError.value = null;
      try {
        await params.settingsRepo.value.saveUserSettings(userSettings.value);
      } catch (e) {
        userSettingsSaveError.value = getErrorMessage(e, 'Failed to save user settings');
        console.warn('Failed to save user settings', e);
        throw e;
      } finally {
        isSavingUserSettings.value = false;
      }
    },
    onError: (e) => {
      console.error('Failed to save user settings', e);
    },
  });

  const isSavingAppSettings = ref(false);
  const appSettingsSaveError = ref<string | null>(null);
  const isBatchUpdatingAppSettings = ref(false);

  const autoSaveAppSettings = createAutoSave({
    doSave: async () => {
      if (!params.settingsRepo.value) return false;
      isSavingAppSettings.value = true;
      appSettingsSaveError.value = null;
      try {
        await params.settingsRepo.value.saveAppSettings(appSettings.value);
      } catch (e) {
        appSettingsSaveError.value = getErrorMessage(e, 'Failed to save app settings');
        console.warn('Failed to save app settings', e);
        throw e;
      } finally {
        isSavingAppSettings.value = false;
      }
    },
    onError: (e) => {
      console.error('Failed to save app settings', e);
    },
  });

  async function requestUserSettingsSave(options?: { immediate?: boolean }) {
    await autoSaveUserSettings.requestSave(options);
  }

  watch(
    userSettings,
    () => {
      if (isBatchUpdatingUserSettings.value) return;
      autoSaveUserSettings.markDirty();
      void requestUserSettingsSave();
    },
    { deep: true, flush: 'sync' },
  );

  async function batchUpdateUserSettings(
    updater: (draft: FastCatUserSettings) => void,
    options?: { immediate?: boolean },
  ) {
    isBatchUpdatingUserSettings.value = true;
    try {
      updater(userSettings.value);
    } finally {
      isBatchUpdatingUserSettings.value = false;
    }

    autoSaveUserSettings.markDirty();
    await requestUserSettingsSave(options);
  }

  async function requestAppSettingsSave(options?: { immediate?: boolean }) {
    await autoSaveAppSettings.requestSave(options);
  }

  watch(
    appSettings,
    () => {
      if (isBatchUpdatingAppSettings.value) return;
      autoSaveAppSettings.markDirty();
      void requestAppSettingsSave();
    },
    { deep: true, flush: 'sync' },
  );

  async function batchUpdateAppSettings(
    updater: (draft: FastCatAppSettings) => void,
    options?: { immediate?: boolean },
  ) {
    isBatchUpdatingAppSettings.value = true;
    try {
      updater(appSettings.value);
    } finally {
      isBatchUpdatingAppSettings.value = false;
    }

    autoSaveAppSettings.markDirty();
    await requestAppSettingsSave(options);
  }

  async function batchUpdateWorkspaceSettings(
    updater: (draft: FastCatWorkspaceSettings) => void,
    options?: { immediate?: boolean },
  ) {
    await batchUpdateAppSettings((draft) => updater(draft as FastCatWorkspaceSettings), options);
  }

  async function loadAppSettingsFromDisk() {
    if (!params.settingsRepo.value) return;

    try {
      const raw = await params.settingsRepo.value.loadAppSettings();
      appSettings.value = normalizeAppSettings(raw);
    } catch {
      appSettings.value = normalizeAppSettings(null);
    } finally {
      autoSaveAppSettings.reset();
      autoSaveAppSettings.markCleanForCurrentRevision();
    }
  }

  async function loadWorkspaceSettingsFromDisk() {
    await loadAppSettingsFromDisk();
  }

  async function loadUserSettingsFromDisk() {
    if (!params.settingsRepo.value) return;

    try {
      const raw = await params.settingsRepo.value.loadUserSettings();
      userSettings.value = normalizeUserSettings(raw);
    } catch {
      userSettings.value = normalizeUserSettings(null);
    } finally {
      autoSaveUserSettings.reset();
      autoSaveUserSettings.markCleanForCurrentRevision();
    }
  }

  async function saveAppSettingsToDisk() {
    await requestAppSettingsSave({ immediate: true });
  }

  async function saveWorkspaceSettingsToDisk() {
    await requestAppSettingsSave({ immediate: true });
  }

  async function saveUserSettingsToDisk() {
    await requestUserSettingsSave({ immediate: true });
  }

  async function flushSettingsSaves() {
    await Promise.all([saveUserSettingsToDisk(), saveAppSettingsToDisk()]);
  }

  function resetSettingsState() {
    userSettings.value = createDefaultUserSettings();
    appSettings.value = createDefaultAppSettings();

    autoSaveUserSettings.reset();
    autoSaveAppSettings.markCleanForCurrentRevision();
    autoSaveAppSettings.reset(); // to clear persistTimeout

    autoSaveAppSettings.reset();
    autoSaveAppSettings.markCleanForCurrentRevision();

    isSavingUserSettings.value = false;
    userSettingsSaveError.value = null;
    isSavingAppSettings.value = false;
    appSettingsSaveError.value = null;
  }

  return {
    userSettings,
    appSettings,
    workspaceSettings,

    isSavingUserSettings,
    userSettingsSaveError,
    isSavingAppSettings,
    appSettingsSaveError,
    isSavingWorkspaceSettings: isSavingAppSettings,
    workspaceSettingsSaveError: appSettingsSaveError,

    batchUpdateUserSettings,
    batchUpdateAppSettings,
    batchUpdateWorkspaceSettings,

    loadAppSettingsFromDisk,
    loadWorkspaceSettingsFromDisk,
    loadUserSettingsFromDisk,

    saveAppSettingsToDisk,
    saveWorkspaceSettingsToDisk,
    saveUserSettingsToDisk,

    flushSettingsSaves,

    resetSettingsState,
  };
}
