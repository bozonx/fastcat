import { ref, type Ref } from 'vue';
import type { useI18n } from 'vue-i18n';
import type { useProjectStore } from '~/stores/project.store';
import type { useTimelineStore } from '~/stores/timeline.store';

export interface UseMobileTimelineVersionOptions {
  timelineStore: ReturnType<typeof useTimelineStore>;
  projectStore: ReturnType<typeof useProjectStore>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useMobileTimelineVersion(options: UseMobileTimelineVersionOptions) {
  const { timelineStore, projectStore, t } = options;

  const isCreateVersionModalOpen = ref(false);
  const proposedVersionName = ref('');
  const existingNamesInFolder = ref<string[]>([]);

  async function handleCreateVersionFromPreview() {
    if (timelineStore.currentTimelinePath) {
      const parts = timelineStore.currentTimelinePath.split('/');
      parts.pop();
      const parentPath = parts.join('/');
      existingNamesInFolder.value = await projectStore.listEntryNames(parentPath);
    } else {
      existingNamesInFolder.value = [];
    }

    proposedVersionName.value = await timelineStore.getNextVersionName();
    isCreateVersionModalOpen.value = true;
  }

  function validateVersionName(newName: string): string | boolean | null {
    const trimmed = newName.trim();
    if (!trimmed) return false;
    const finalName = trimmed.toLowerCase().endsWith('.otio') ? trimmed : `${trimmed}.otio`;
    if (existingNamesInFolder.value.includes(finalName)) {
      return t('common.validation.exists');
    }
    return true;
  }

  async function handleConfirmCreateVersion(newName: string) {
    isCreateVersionModalOpen.value = false;
    if (timelineStore.previewBackupInfo) {
      await timelineStore.createVersionFromBackup(timelineStore.previewBackupInfo, newName);
    }
  }

  return {
    isCreateVersionModalOpen: isCreateVersionModalOpen as Ref<boolean>,
    proposedVersionName: proposedVersionName as Ref<string>,
    existingNamesInFolder: existingNamesInFolder as Ref<string[]>,
    handleCreateVersionFromPreview,
    validateVersionName,
    handleConfirmCreateVersion,
  };
}
