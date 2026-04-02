<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import FileDeleteConfirmModal from '~/components/file-manager/modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from '~/components/file-manager/modals/FileTranscriptionModal.vue';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';

interface Props {
  deleteTargets: FsEntry[];
  isDeleteConfirmModalOpen: boolean;
  remoteTransferOpen: boolean;
  remoteTransferProgress: number;
  remoteTransferPhase: string;
  remoteTransferFileName: string;
  transcriptionModalOpen: boolean;
  isTranscribing: boolean;
  transcriptionError: string;
  transcriptionEntry: FsEntry | null;
  transcriptionLanguage: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:isDeleteConfirmModalOpen', value: boolean): void;
  (e: 'update:transcriptionModalOpen', value: boolean): void;
  (e: 'update:transcriptionLanguage', value: string): void;
  (e: 'deleteConfirm'): void;
  (e: 'cancelRemoteTransfer'): void;
  (e: 'submitTranscription'): void;
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
    :transcription-error="props.transcriptionError"
    :transcription-entry="props.transcriptionEntry"
    :transcription-language="props.transcriptionLanguage"
    @update:open="emit('update:transcriptionModalOpen', $event)"
    @update:transcription-language="emit('update:transcriptionLanguage', $event)"
    @submit="emit('submitTranscription')"
  />
</template>
