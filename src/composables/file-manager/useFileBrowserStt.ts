import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { transcribeProjectAudioFile } from '~/utils/stt';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';
import type { ExtendedFsEntry } from '~/composables/fileManager/useFileBrowserEntries';

export function useFileBrowserStt() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const runtimeConfig = useRuntimeConfig();
  const toast = useToast();
  const { t } = useI18n();

  const sttTranscriptionModalOpen = ref(false);
  const sttTranscriptionLanguage = ref('');
  const sttTranscriptionError = ref('');
  const sttTranscribing = ref(false);
  const sttTranscriptionEntry = ref<FsEntry | null>(null);

  const bloggerDogApiUrl = computed(() =>
    typeof runtimeConfig.public.bloggerDogApiUrl === 'string'
      ? runtimeConfig.public.bloggerDogApiUrl
      : '',
  );

  const sttConfig = computed(() =>
    resolveExternalServiceConfig({
      service: 'stt',
      integrations: workspaceStore.userSettings.integrations,
      bloggerDogApiUrl: bloggerDogApiUrl.value,
    }),
  );

  function isTranscribableMediaFile(entry: FsEntry): boolean {
    if (entry.kind !== 'file' || entry.source === 'remote') return false;
    const type = getMediaTypeFromFilename(entry.name);
    return (
      (type === 'audio' || type === 'video') &&
      Boolean(sttConfig.value) &&
      Boolean(workspaceStore.workspaceHandle) &&
      Boolean(projectStore.currentProjectId) &&
      Boolean(entry.path)
    );
  }

  function openTranscriptionModal(entry: FsEntry) {
    sttTranscriptionLanguage.value = '';
    sttTranscriptionError.value = '';
    sttTranscriptionModalOpen.value = true;
    sttTranscriptionEntry.value = entry;
  }

  async function submitTranscription() {
    const entry = sttTranscriptionEntry.value;
    if (
      !entry ||
      entry.kind !== 'file' ||
      !workspaceStore.workspaceHandle ||
      !projectStore.currentProjectId
    ) {
      return;
    }

    sttTranscribing.value = true;
    sttTranscriptionError.value = '';

    try {
      const mediaType = getMediaTypeFromFilename(entry.name);
      const entryMimeType = (entry as ExtendedFsEntry).mimeType;
      const file = await projectStore.getFileByPath(entry.path);
      const fileType = file?.type || entryMimeType || '';

      if (!file) throw new Error('Failed to access file for transcription');

      const request: any = {
        file,
        filePath: entry.path,
        fileName: entry.name,
        fileType,
        language: sttTranscriptionLanguage.value,
        bloggerDogApiUrl: bloggerDogApiUrl.value,
        projectId: projectStore.currentProjectId!,
        userSettings: workspaceStore.userSettings,
        workspaceHandle: workspaceStore.workspaceHandle!,
        resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
      };

      const result = await transcribeProjectAudioFile(request);
      sttTranscriptionModalOpen.value = false;

      toast.add({
        title: result.cached
          ? t('videoEditor.fileManager.audio.transcriptionCached', 'Using cached transcription')
          : t('videoEditor.fileManager.audio.transcriptionCompleted', 'Transcription completed'),
        description: result.cached
          ? t(
              'videoEditor.fileManager.audio.transcriptionCachedDescription',
              'Cached transcription was loaded from vardata.',
            )
          : mediaType === 'video'
            ? t(
                'videoEditor.fileManager.audio.transcriptionSavedVideoDescription',
                'Video audio track was transcribed and saved to vardata cache.',
              )
            : t(
                'videoEditor.fileManager.audio.transcriptionSavedDescription',
                'Transcription was saved to vardata cache.',
              ),
        color: 'success',
      });
    } catch (error: unknown) {
      sttTranscriptionError.value =
        error instanceof Error
          ? error.message
          : t('videoEditor.fileManager.audio.transcriptionFailed', 'Failed to transcribe media');
    } finally {
      sttTranscribing.value = false;
    }
  }

  return {
    sttConfig,
    sttTranscriptionModalOpen,
    sttTranscriptionLanguage,
    sttTranscriptionError,
    sttTranscribing,
    sttTranscriptionEntry,
    isTranscribableMediaFile,
    openTranscriptionModal,
    submitTranscription,
  };
}
