import { ref, watch, type Ref } from 'vue';
import PQueue from 'p-queue';
import { useDebounceFn } from '@vueuse/core';

import {
  type GranVideoEditorUserSettings,
  type GranVideoEditorWorkspaceSettings,
  createDefaultUserSettings,
  createDefaultWorkspaceSettings,
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
  userSettings: Ref<GranVideoEditorUserSettings>;
  workspaceSettings: Ref<GranVideoEditorWorkspaceSettings>;

  isSavingUserSettings: Ref<boolean>;
  userSettingsSaveError: Ref<string | null>;
  isSavingWorkspaceSettings: Ref<boolean>;
  workspaceSettingsSaveError: Ref<string | null>;

  batchUpdateUserSettings: (
    updater: (draft: GranVideoEditorUserSettings) => void,
    options?: { immediate?: boolean },
  ) => Promise<void>;
  batchUpdateWorkspaceSettings: (
    updater: (draft: GranVideoEditorWorkspaceSettings) => void,
    options?: { immediate?: boolean },
  ) => Promise<void>;

  loadWorkspaceSettingsFromDisk: () => Promise<void>;
  loadUserSettingsFromDisk: () => Promise<void>;

  saveWorkspaceSettingsToDisk: () => Promise<void>;
  saveUserSettingsToDisk: () => Promise<void>;

  flushSettingsSaves: () => Promise<void>;

  resetSettingsState: () => void;
}

export function createWorkspaceSettingsModule(params: {
  settingsRepo: Ref<WorkspaceSettingsRepository | null>;
}): WorkspaceSettingsModule {
  const userSettings = ref<GranVideoEditorUserSettings>(createDefaultUserSettings());
  const workspaceSettings = ref<GranVideoEditorWorkspaceSettings>(createDefaultWorkspaceSettings());

  const isSavingUserSettings = ref(false);
  const userSettingsSaveError = ref<string | null>(null);
  const isBatchUpdatingUserSettings = ref(false);
  const debouncedEnqueueUserSettingsSave = useDebounceFn(async () => {
    await enqueueUserSettingsSave();
  }, 500);
  let userSettingsRevision = 0;
  let savedUserSettingsRevision = 0;
  const userSettingsSaveQueue = new PQueue({ concurrency: 1 });

  const isSavingWorkspaceSettings = ref(false);
  const workspaceSettingsSaveError = ref<string | null>(null);
  const isBatchUpdatingWorkspaceSettings = ref(false);
  const debouncedEnqueueWorkspaceSettingsSave = useDebounceFn(async () => {
    await enqueueWorkspaceSettingsSave();
  }, 500);
  let workspaceSettingsRevision = 0;
  let savedWorkspaceSettingsRevision = 0;
  const workspaceSettingsSaveQueue = new PQueue({ concurrency: 1 });

  function markUserSettingsAsDirty() {
    userSettingsRevision += 1;
  }

  function markWorkspaceSettingsAsDirty() {
    workspaceSettingsRevision += 1;
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
    updater: (draft: GranVideoEditorUserSettings) => void,
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

  async function persistWorkspaceSettingsNow() {
    if (!params.settingsRepo.value) return;
    if (savedWorkspaceSettingsRevision >= workspaceSettingsRevision) return;

    isSavingWorkspaceSettings.value = true;
    workspaceSettingsSaveError.value = null;
    const revisionToSave = workspaceSettingsRevision;

    try {
      await params.settingsRepo.value.saveWorkspaceSettings(workspaceSettings.value);

      if (savedWorkspaceSettingsRevision < revisionToSave) {
        savedWorkspaceSettingsRevision = revisionToSave;
      }
    } catch (e) {
      workspaceSettingsSaveError.value = getErrorMessage(e, 'Failed to save workspace settings');
      console.warn('Failed to save workspace settings', e);
    } finally {
      isSavingWorkspaceSettings.value = false;
    }
  }

  async function enqueueWorkspaceSettingsSave() {
    await workspaceSettingsSaveQueue.add(async () => {
      await persistWorkspaceSettingsNow();
    });
  }

  async function requestWorkspaceSettingsSave(options?: { immediate?: boolean }) {
    if (options?.immediate || typeof window === 'undefined') {
      await enqueueWorkspaceSettingsSave();
      return;
    }
    await debouncedEnqueueWorkspaceSettingsSave();
  }

  watch(
    workspaceSettings,
    () => {
      if (isBatchUpdatingWorkspaceSettings.value) return;
      markWorkspaceSettingsAsDirty();
      void requestWorkspaceSettingsSave();
    },
    { deep: true },
  );

  async function batchUpdateWorkspaceSettings(
    updater: (draft: GranVideoEditorWorkspaceSettings) => void,
    options?: { immediate?: boolean },
  ) {
    isBatchUpdatingWorkspaceSettings.value = true;
    try {
      updater(workspaceSettings.value);
    } finally {
      isBatchUpdatingWorkspaceSettings.value = false;
    }

    markWorkspaceSettingsAsDirty();
    await requestWorkspaceSettingsSave(options);
  }

  async function loadWorkspaceSettingsFromDisk() {
    if (!params.settingsRepo.value) return;

    try {
      const raw = await params.settingsRepo.value.loadWorkspaceSettings();
      workspaceSettings.value = normalizeWorkspaceSettings(raw);
    } catch {
      workspaceSettings.value = normalizeWorkspaceSettings(null);
    } finally {
      workspaceSettingsRevision = 0;
      savedWorkspaceSettingsRevision = 0;
    }
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

  async function saveWorkspaceSettingsToDisk() {
    await requestWorkspaceSettingsSave({ immediate: true });
  }

  async function saveUserSettingsToDisk() {
    await requestUserSettingsSave({ immediate: true });
  }

  async function flushSettingsSaves() {
    await Promise.all([saveUserSettingsToDisk(), saveWorkspaceSettingsToDisk()]);
  }

  function resetSettingsState() {
    userSettings.value = createDefaultUserSettings();
    workspaceSettings.value = createDefaultWorkspaceSettings();

    userSettingsRevision = 0;
    savedUserSettingsRevision = 0;
    workspaceSettingsRevision = 0;
    savedWorkspaceSettingsRevision = 0;

    isSavingUserSettings.value = false;
    userSettingsSaveError.value = null;
    isSavingWorkspaceSettings.value = false;
    workspaceSettingsSaveError.value = null;
  }

  return {
    userSettings,
    workspaceSettings,

    isSavingUserSettings,
    userSettingsSaveError,
    isSavingWorkspaceSettings,
    workspaceSettingsSaveError,

    batchUpdateUserSettings,
    batchUpdateWorkspaceSettings,

    loadWorkspaceSettingsFromDisk,
    loadUserSettingsFromDisk,

    saveWorkspaceSettingsToDisk,
    saveUserSettingsToDisk,

    flushSettingsSaves,

    resetSettingsState,
  };
}
