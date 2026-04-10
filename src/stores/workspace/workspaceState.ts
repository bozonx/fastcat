import { ref, watch, type Ref } from 'vue';
import { createAutoSave } from '~/utils/auto-save';
import { getErrorMessage } from '~/utils/errors';
import {
  type WorkspaceState,
  createDefaultWorkspaceState,
  normalizeWorkspaceState,
} from '~/utils/workspace-state';
import type { WorkspaceSettingsRepository } from '~/repositories/workspace-settings.repository';

export interface WorkspaceStateModule {
  workspaceState: Ref<WorkspaceState>;
  isSavingWorkspaceState: Ref<boolean>;
  workspaceStateSaveError: Ref<string | null>;

  batchUpdateWorkspaceState: (
    updater: (draft: WorkspaceState) => void,
    options?: { immediate?: boolean },
  ) => Promise<void>;

  loadWorkspaceStateFromDisk: () => Promise<void>;
  saveWorkspaceStateToDisk: () => Promise<void>;

  resetWorkspaceState: () => void;
}

export function createWorkspaceStateModule(params: {
  settingsRepo: Ref<WorkspaceSettingsRepository | null>;
}): WorkspaceStateModule {
  const workspaceState = ref<WorkspaceState>(createDefaultWorkspaceState());
  const isSavingWorkspaceState = ref(false);
  const workspaceStateSaveError = ref<string | null>(null);
  const isBatchUpdating = ref(false);

  const autoSave = createAutoSave({
    doSave: async () => {
      if (!params.settingsRepo.value) return false;
      isSavingWorkspaceState.value = true;
      workspaceStateSaveError.value = null;
      try {
        await params.settingsRepo.value.saveWorkspaceState(workspaceState.value);
      } catch (e) {
        workspaceStateSaveError.value = getErrorMessage(e, 'Failed to save workspace state');
        console.warn('Failed to save workspace state', e);
        throw e;
      } finally {
        isSavingWorkspaceState.value = false;
      }
    },
    onError: (e) => {
      console.error('Failed to save workspace state', e);
    },
  });

  async function requestSave(options?: { immediate?: boolean }) {
    await autoSave.requestSave(options);
  }

  watch(
    workspaceState,
    () => {
      if (isBatchUpdating.value) return;
      autoSave.markDirty();
      void requestSave();
    },
    { deep: true, flush: 'sync' },
  );

  async function batchUpdateWorkspaceState(
    updater: (draft: WorkspaceState) => void,
    options?: { immediate?: boolean },
  ) {
    isBatchUpdating.value = true;
    try {
      updater(workspaceState.value);
    } finally {
      isBatchUpdating.value = false;
    }

    autoSave.markDirty();
    await requestSave(options);
  }

  async function loadWorkspaceStateFromDisk() {
    if (!params.settingsRepo.value) return;

    try {
      const raw = await params.settingsRepo.value.loadWorkspaceState();
      workspaceState.value = normalizeWorkspaceState(raw);
    } catch {
      workspaceState.value = normalizeWorkspaceState(null);
    } finally {
      autoSave.reset();
      autoSave.markCleanForCurrentRevision();
    }
  }

  async function saveWorkspaceStateToDisk() {
    await requestSave({ immediate: true });
  }

  function resetWorkspaceState() {
    workspaceState.value = createDefaultWorkspaceState();
    autoSave.reset();
    isSavingWorkspaceState.value = false;
    workspaceStateSaveError.value = null;
  }

  return {
    workspaceState,
    isSavingWorkspaceState,
    workspaceStateSaveError,
    batchUpdateWorkspaceState,
    loadWorkspaceStateFromDisk,
    saveWorkspaceStateToDisk,
    resetWorkspaceState,
  };
}
