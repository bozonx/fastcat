<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import FileDeleteConfirmModal from '~/components/file-manager/modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from '~/components/file-manager/modals/FileTranscriptionModal.vue';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';
import UiEntityCreationModal from '~/components/ui/UiEntityCreationModal.vue';

interface Props {
  deleteTargets: FsEntry[];
  isDeleteConfirmModalOpen: boolean;
  remoteTransferOpen: boolean;
  remoteTransferProgress: number;
  remoteTransferPhase: string;
  remoteTransferFileName: string;
  transcriptionModalOpen: boolean;
  isTranscribing: boolean;
  isModelReady: boolean;
  transcriptionError: string | null;
  transcriptionEntry: FsEntry | null;
  transcriptionLanguage: string;
  // Creation modals
  isFolderModalOpen: boolean;
  folderDefaultName: string;
  isSubgroupModalOpen: boolean;
  isItemModalOpen: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:isDeleteConfirmModalOpen', value: boolean): void;
  (e: 'update:transcriptionModalOpen', value: boolean): void;
  (e: 'update:transcriptionLanguage', value: string): void;
  (e: 'update:isSubgroupModalOpen', value: boolean): void;
  (e: 'update:isItemModalOpen', value: boolean): void;
  (e: 'update:isFolderModalOpen', value: boolean): void;
  (e: 'deleteConfirm'): void;
  (e: 'cancelRemoteTransfer'): void;
  (e: 'submitTranscription'): void;
  (e: 'subgroupConfirm', name: string): void;
  (e: 'itemConfirm', name: string): void;
  (e: 'folderConfirm', name: string): void;
}>();

const { t } = useI18n();
</script>

<template>
  <FileDeleteConfirmModal
    :open="props.isDeleteConfirmModalOpen"
    :delete-targets="props.deleteTargets"
    @update:open="emit('update:isDeleteConfirmModalOpen', $event)"
    @confirm="emit('deleteConfirm')"
  />

  <RemoteTransferProgressModal
    :open="props.remoteTransferOpen"
    :title="t('videoEditor.fileManager.actions.downloadFiles')"
    :description="t('videoEditor.fileManager.actions.downloadFiles')"
    :progress="props.remoteTransferProgress"
    :phase="props.remoteTransferPhase"
    :file-name="props.remoteTransferFileName"
    @cancel="emit('cancelRemoteTransfer')"
  />

  <FileSttTranscriptionModal
    :open="props.transcriptionModalOpen"
    :is-transcribing="props.isTranscribing"
    :is-model-ready="props.isModelReady"
    :transcription-error="props.transcriptionError"
    :transcription-entry="props.transcriptionEntry"
    :transcription-language="props.transcriptionLanguage"
    @update:open="emit('update:transcriptionModalOpen', $event)"
    @update:transcription-language="emit('update:transcriptionLanguage', $event)"
    @submit="emit('submitTranscription')"
  />

  <UiEntityCreationModal
    :open="props.isFolderModalOpen"
    :title="t('videoEditor.fileManager.actions.createFolder')"
    :default-value="props.folderDefaultName"
    @update:open="emit('update:isFolderModalOpen', $event)"
    @confirm="emit('folderConfirm', $event)"
  />

  <UiEntityCreationModal
    :open="props.isSubgroupModalOpen"
    :title="t('fastcat.bloggerDog.actions.createSubgroup')"
    :confirm-label="t('common.create')"
    @update:open="emit('update:isSubgroupModalOpen', $event)"
    @confirm="emit('subgroupConfirm', $event)"
  />

  <UiEntityCreationModal
    :open="props.isItemModalOpen"
    :title="t('fastcat.bloggerDog.actions.createItem')"
    :confirm-label="t('common.create')"
    @update:open="emit('update:isItemModalOpen', $event)"
    @confirm="emit('itemConfirm', $event)"
  />
</template>
