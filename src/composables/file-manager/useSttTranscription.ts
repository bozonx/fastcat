import { ref, computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getMediaTypeFromFilename, getMimeTypeFromFilename } from '~/utils/media-types';
import { runTranscriptionTask } from '~/utils/transcription/task-wrapper';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';

export interface UseSttTranscriptionOptions {
  vfs?: { getFile: (path: string) => Promise<File | null> };
  fastcatAccountApiUrl?: Ref<string> | string;
  onSuccess?: (params: { cached: boolean; mediaType: string }) => void;
  onError?: (message: string) => void;
}

export interface SttTranscriptionState {
  sttConfig: Ref<ResolvedExternalServiceConfig | null>;
  modalOpen: Ref<boolean>;
  language: Ref<string>;
  errorMessage: Ref<string>;
  isTranscribing: Ref<boolean>;
  pendingEntry: Ref<FsEntry | null>;
  isTranscribableMediaFile: (entry: FsEntry) => boolean;
  openModal: (entry: FsEntry) => void;
  closeModal: () => void;
  submitTranscription: () => Promise<void>;
}

export function useSttTranscription(
  options: UseSttTranscriptionOptions = {},
): SttTranscriptionState {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const { t } = useI18n();

  const fastcatApiUrl = computed(() => {
    if (!options.fastcatAccountApiUrl) return '';
    return typeof options.fastcatAccountApiUrl === 'string'
      ? options.fastcatAccountApiUrl
      : options.fastcatAccountApiUrl.value;
  });

  const modalOpen = ref(false);
  const language = ref('');
  const errorMessage = ref('');
  const isTranscribing = ref(false);
  const pendingEntry = ref<FsEntry | null>(null);

  const sttConfig = computed(() =>
    resolveExternalServiceConfig({
      service: 'stt',
      integrations: workspaceStore.userSettings.integrations,
      bloggerDogApiUrl: '',
      fastcatAccountApiUrl: fastcatApiUrl.value,
    }),
  );

  function isTranscribableMediaFile(entry: FsEntry): boolean {
    if (entry.kind !== 'file' || entry.source === 'remote') return false;
    const mediaType = getMediaTypeFromFilename(entry.name);
    const isLocal = workspaceStore.userSettings.integrations.stt.provider === 'local';

    return (
      (mediaType === 'audio' || mediaType === 'video') &&
      (isLocal ? workspaceStore.isSttModelDownloaded : Boolean(sttConfig.value)) &&
      Boolean(workspaceStore.workspaceHandle) &&
      Boolean(projectStore.currentProjectId) &&
      Boolean(entry.path)
    );
  }

  function openModal(entry: FsEntry) {
    pendingEntry.value = entry;
    language.value = workspaceStore.userSettings.integrations.stt.language || '';
    errorMessage.value = '';
    modalOpen.value = true;
  }

  function closeModal() {
    modalOpen.value = false;
  }

  async function submitTranscription(): Promise<void> {
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

      let file: File | null = null;
      if (options.vfs) {
        file = await options.vfs.getFile(entry.path);
      } else {
        file = await projectStore.getFileByPath(entry.path);
      }

      if (!file) {
        throw new Error('Failed to access file');
      }

      const workspacePath =
        entry.path.startsWith('/') ||
        entry.path.startsWith('projects/') ||
        !projectStore.currentProjectName
          ? entry.path
          : `projects/${projectStore.currentProjectName}/${entry.path}`;

      const defaultTitle = `Transcription: ${entry.name}`;
      const result = await runTranscriptionTask({
        file,
        filePath: workspacePath,
        fileName: entry.name,
        fileType: getMimeTypeFromFilename(entry.name),
        language: language.value,
        fastcatAccountApiUrl: fastcatApiUrl.value,
        userSettings: workspaceStore.userSettings,
        workspaceHandle: workspaceStore.workspaceHandle!,
        title: t(
          'videoEditor.backgroundTasks.transcriptionTitle',
          { name: entry.name },
          defaultTitle,
        ),
      });

      modalOpen.value = false;
      options.onSuccess?.({ cached: result.cached, mediaType });
    } catch (error: unknown) {
      if (
        (error as Error).name === 'AbortError' ||
        (error as Error).message === 'Transcription cancelled'
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to transcribe media';
      errorMessage.value = message;
      options.onError?.(message);
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
