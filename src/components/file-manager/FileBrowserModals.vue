<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import FileDeleteConfirmModal from '~/components/file-manager/modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from '~/components/file-manager/modals/FileSttTranscriptionModal.vue';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';

interface Props {
  deleteTargets: FsEntry[];
  isDeleteConfirmModalOpen: boolean;
  remoteTransferOpen: boolean;
  remoteTransferProgress: number;
  remoteTransferPhase: string;
  remoteTransferFileName: string;
  sttTranscriptionModalOpen: boolean;
  sttTranscribing: boolean;
  sttTranscriptionError: string;
  sttTranscriptionEntry: FsEntry | null;
  sttTranscriptionLanguage: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:isDeleteConfirmModalOpen', value: boolean): void;
  (e: 'update:sttTranscriptionModalOpen', value: boolean): void;
  (e: 'update:sttTranscriptionLanguage', value: string): void;
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
    :open="props.sttTranscriptionModalOpen"
    :stt-transcribing="props.sttTranscribing"
    :stt-transcription-error="props.sttTranscriptionError"
    :stt-transcription-entry="props.sttTranscriptionEntry"
    :stt-transcription-language="props.sttTranscriptionLanguage"
    @update:open="emit('update:sttTranscriptionModalOpen', $event)"
    @update:stt-transcription-language="emit('update:sttTranscriptionLanguage', $event)"
    @submit="emit('submitTranscription')"
  />
</template>

