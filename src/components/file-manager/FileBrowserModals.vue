<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import FileDeleteConfirmModal from '~/components/file-manager/modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from '~/components/file-manager/modals/FileTranscriptionModal.vue';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';
import FileNameModal from '~/components/file-manager/modals/FileNameModal.vue';

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
  (e: 'deleteConfirm'): void;
  (e: 'cancelRemoteTransfer'): void;
  (e: 'submitTranscription'): void;
  (e: 'subgroupConfirm', name: string): void;
  (e: 'itemConfirm', name: string): void;
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
    :title="t('videoEditor.fileManager.actions.downloadFiles', 'Download files')"
    :description="t('videoEditor.fileManager.actions.downloadFiles', 'Download files')"
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

  <FileNameModal
    :model-value="props.isSubgroupModalOpen"
    :title="t('fastcat.bloggerDog.actions.createFolder', 'Создать подгруппу')"
    :confirm-label="t('common.create', 'Создать')"
    @update:model-value="emit('update:isSubgroupModalOpen', $event)"
    @confirm="emit('subgroupConfirm', $event)"
  />

  <FileNameModal
    :model-value="props.isItemModalOpen"
    :title="t('fastcat.bloggerDog.actions.createItem', 'Создать элемент контента')"
    :confirm-label="t('common.create', 'Создать')"
    @update:model-value="emit('update:isItemModalOpen', $event)"
    @confirm="emit('itemConfirm', $event)"
  />
</template>
