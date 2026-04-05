import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { transcribeAudioFile } from '~/utils/transcription/engine';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';
import type { ExtendedFsEntry } from '~/composables/file-manager/useFileBrowserEntries';

export function useFileBrowserTranscription() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const runtimeConfig = useRuntimeConfig();
  const toast = useToast();
  const { t } = useI18n();

  const transcriptionModalOpen = ref(false);
  const transcriptionLanguage = ref('');
  const transcriptionError = ref('');
  const isTranscribing = ref(false);
  const transcriptionEntry = ref<FsEntry | null>(null);

  const fastcatAccountApiUrl = computed(() =>
    typeof runtimeConfig.public.fastcatAccountApiUrl === 'string'
      ? runtimeConfig.public.fastcatAccountApiUrl
      : '',
  );

  const sttConfig = computed(() =>
    resolveExternalServiceConfig({
      service: 'stt',
      integrations: workspaceStore.userSettings.integrations,
      bloggerDogApiUrl: '', // BloggerDog removed for STT
      fastcatAccountApiUrl: fastcatAccountApiUrl.value,
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
    transcriptionLanguage.value = '';
    transcriptionError.value = '';
    transcriptionModalOpen.value = true;
    transcriptionEntry.value = entry;
  }

  async function submitTranscription() {
    const entry = transcriptionEntry.value;
    if (
      !entry ||
      entry.kind !== 'file' ||
      !workspaceStore.workspaceHandle ||
      !projectStore.currentProjectId
    ) {
      return;
    }

    isTranscribing.value = true;
    transcriptionError.value = '';

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
        language: transcriptionLanguage.value,
        fastcatAccountApiUrl: fastcatAccountApiUrl.value,
        projectId: projectStore.currentProjectId!,
        userSettings: workspaceStore.userSettings,
        workspaceHandle: workspaceStore.workspaceHandle!,
        resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
      };

      const result = await transcribeAudioFile(request);
      transcriptionModalOpen.value = false;

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
      transcriptionError.value =
        error instanceof Error
          ? error.message
          : t('videoEditor.fileManager.audio.transcriptionFailed', 'Failed to transcribe media');
    } finally {
      isTranscribing.value = false;
    }
  }

  return {
    sttConfig,
    transcriptionModalOpen,
    transcriptionLanguage,
    transcriptionError,
    isTranscribing,
    transcriptionEntry,
    isTranscribableMediaFile,
    openTranscriptionModal,
    submitTranscription,
  };
}
