import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getMediaTypeFromFilename, getMimeTypeFromFilename } from '~/utils/media-types';
import { transcribeProjectAudioFile } from '~/utils/stt';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';

export interface FileManagerPanelSttOptions {
  vfs: { getFile: (path: string) => Promise<File | null> };
  fastcatPublicadorBaseUrl: string;
  onSuccess: (params: { cached: boolean; mediaType: string }) => void;
  onError: (message: string) => void;
}

export function useFileManagerPanelStt({
  vfs,
  fastcatPublicadorBaseUrl,
  onSuccess,
  onError,
}: FileManagerPanelSttOptions) {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  const modalOpen = ref(false);
  const language = ref('');
  const errorMessage = ref('');
  const isTranscribing = ref(false);
  const pendingEntry = ref<FsEntry | null>(null);

  const sttConfig = computed(() =>
    resolveExternalServiceConfig({
      service: 'stt',
      integrations: workspaceStore.userSettings.integrations,
      fastcatPublicadorBaseUrl,
    }),
  );

  function isTranscribableMediaFile(entry: FsEntry): boolean {
    if (entry.kind !== 'file' || entry.source === 'remote') return false;
    const mediaType = getMediaTypeFromFilename(entry.name);
    return (
      (mediaType === 'audio' || mediaType === 'video') &&
      Boolean(sttConfig.value) &&
      Boolean(workspaceStore.workspaceHandle) &&
      Boolean(projectStore.currentProjectId) &&
      Boolean(entry.path)
    );
  }

  function openModal(entry: FsEntry) {
    pendingEntry.value = entry;
    language.value = '';
    errorMessage.value = '';
    modalOpen.value = true;
  }

  function closeModal() {
    modalOpen.value = false;
  }

  async function submitTranscription() {
    const entry = pendingEntry.value;
    if (
      !entry ||
      entry.kind !== 'file' ||
      !workspaceStore.workspaceHandle ||
      !projectStore.currentProjectId
    ) {
      return;
    }

    isTranscribing.value = true;
    errorMessage.value = '';

    try {
      const mediaType = getMediaTypeFromFilename(entry.name);
      const file = await vfs.getFile(entry.path);
      if (!file) throw new Error('Failed to access file');

      const result = await transcribeProjectAudioFile({
        file,
        filePath: entry.path,
        fileName: entry.name,
        fileType: getMimeTypeFromFilename(entry.name),
        language: language.value,
        fastcatPublicadorBaseUrl,
        projectId: projectStore.currentProjectId!,
        userSettings: workspaceStore.userSettings,
        workspaceHandle: workspaceStore.workspaceHandle!,
        resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
      });

      modalOpen.value = false;
      onSuccess({ cached: result.cached, mediaType });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to transcribe media';
      errorMessage.value = message;
      onError(message);
    } finally {
      isTranscribing.value = false;
    }
  }

  return {
    sttConfig,
    modalOpen,
    language,
    errorMessage,
    isTranscribing,
    pendingEntry,
    isTranscribableMediaFile,
    openModal,
    closeModal,
    submitTranscription,
  };
}
