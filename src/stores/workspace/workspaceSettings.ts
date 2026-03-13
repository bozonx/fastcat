import { ref, watch, type Ref } from 'vue';
import PQueue from 'p-queue';
import { useDebounceFn } from '@vueuse/core';

import {
  type FastCatAppSettings,
  type FastCatUserSettings,
  type FastCatWorkspaceSettings,
  createDefaultAppSettings,
  createDefaultUserSettings,
  createDefaultWorkspaceSettings,
  normalizeAppSettings,
  normalizeUserSettings,
  normalizeWorkspaceSettings,
} from '~/utils/settings';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';

function getErrorMessage(e: unknown, fallback: string): string {
  if (!e || typeof e !== 'object') return fallback;
  if (!('message' in e)) return fallback;
  const msg = (e as { message?: unknown }).message;
  return typeof msg === 'string' && msg.length > 0 ? msg : fallback;
}

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
  const debouncedEnqueueUserSettingsSave = useDebounceFn(async () => {
    await enqueueUserSettingsSave();
  }, 500);
  let userSettingsRevision = 0;
  let savedUserSettingsRevision = 0;
  const userSettingsSaveQueue = new PQueue({ concurrency: 1 });

  const isSavingAppSettings = ref(false);
  const appSettingsSaveError = ref<string | null>(null);
  const isBatchUpdatingAppSettings = ref(false);
  const debouncedEnqueueAppSettingsSave = useDebounceFn(async () => {
    await enqueueAppSettingsSave();
  }, 500);
  let appSettingsRevision = 0;
  let savedAppSettingsRevision = 0;
  const appSettingsSaveQueue = new PQueue({ concurrency: 1 });

  function markUserSettingsAsDirty() {
    userSettingsRevision += 1;
  }

  function markAppSettingsAsDirty() {
    appSettingsRevision += 1;
  }

  async function persistUserSettingsNow() {
    if (!params.settingsRepo.value) return;
    if (savedUserSettingsRevision >= userSettingsRevision) return;

    isSavingUserSettings.value = true;
    userSettingsSaveError.value = null;
    const revisionToSave = userSettingsRevision;

    try {
      await params.settingsRepo.value.saveUserSettings(userSettings.value);

      if (savedUserSettingsRevision < revisionToSave) {
        savedUserSettingsRevision = revisionToSave;
      }
    } catch (e) {
      userSettingsSaveError.value = getErrorMessage(e, 'Failed to save user settings');
      console.warn('Failed to save user settings', e);
    } finally {
      isSavingUserSettings.value = false;
    }
  }

  async function enqueueUserSettingsSave() {
    await userSettingsSaveQueue.add(async () => {
      await persistUserSettingsNow();
    });
  }

  async function requestUserSettingsSave(options?: { immediate?: boolean }) {
    if (options?.immediate || typeof window === 'undefined') {
      await enqueueUserSettingsSave();
      return;
    }
    await debouncedEnqueueUserSettingsSave();
  }

  watch(
    userSettings,
    () => {
      if (isBatchUpdatingUserSettings.value) return;
      markUserSettingsAsDirty();
      void requestUserSettingsSave();
    },
    { deep: true },
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

    markUserSettingsAsDirty();
    await requestUserSettingsSave(options);
  }

  async function persistAppSettingsNow() {
    if (!params.settingsRepo.value) return;
    if (savedAppSettingsRevision >= appSettingsRevision) return;

    isSavingAppSettings.value = true;
    appSettingsSaveError.value = null;
    const revisionToSave = appSettingsRevision;

    try {
      await params.settingsRepo.value.saveAppSettings(appSettings.value);

      if (savedAppSettingsRevision < revisionToSave) {
        savedAppSettingsRevision = revisionToSave;
      }
    } catch (e) {
      appSettingsSaveError.value = getErrorMessage(e, 'Failed to save app settings');
      console.warn('Failed to save app settings', e);
    } finally {
      isSavingAppSettings.value = false;
    }
  }

  async function enqueueAppSettingsSave() {
    await appSettingsSaveQueue.add(async () => {
      await persistAppSettingsNow();
    });
  }

  async function requestAppSettingsSave(options?: { immediate?: boolean }) {
    if (options?.immediate || typeof window === 'undefined') {
      await enqueueAppSettingsSave();
      return;
    }
    await debouncedEnqueueAppSettingsSave();
  }

  watch(
    appSettings,
    () => {
      if (isBatchUpdatingAppSettings.value) return;
      markAppSettingsAsDirty();
      void requestAppSettingsSave();
    },
    { deep: true },
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

    markAppSettingsAsDirty();
    await requestAppSettingsSave(options);
  }

  async function batchUpdateWorkspaceSettings(
    updater: (draft: FastCatWorkspaceSettings) => void,
    options?: { immediate?: boolean },
  ) {
    await batchUpdateAppSettings(
      (draft) => updater(draft as FastCatWorkspaceSettings),
      options,
    );
  }

  async function loadAppSettingsFromDisk() {
    if (!params.settingsRepo.value) return;

    try {
      const raw = await params.settingsRepo.value.loadAppSettings();
      appSettings.value = normalizeAppSettings(raw);
    } catch {
      appSettings.value = normalizeAppSettings(null);
    } finally {
      appSettingsRevision = 0;
      savedAppSettingsRevision = 0;
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
      userSettingsRevision = 0;
      savedUserSettingsRevision = 0;
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

    userSettingsRevision = 0;
    savedUserSettingsRevision = 0;
    appSettingsRevision = 0;
    savedAppSettingsRevision = 0;

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
