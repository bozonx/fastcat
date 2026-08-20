import { ref, computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getMediaTypeFromFilename, getMimeTypeFromFilename } from '~/utils/media-types';
import { runTranscriptionTask } from '~/utils/transcription/task-wrapper';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { loadTranscriptionSidecar } from '~/utils/transcription/persistence';

export interface UseSttTranscriptionOptions {
  vfs?: { getFile: (path: string) => Promise<File | null> };
  fastcatAccountApiUrl?: Ref<string> | string;
  onSuccess?: (params: { mediaType: string; cached: boolean }) => void;
  onError?: (message: string) => void;
}

export interface SttTranscriptionState {
  sttConfig: Ref<unknown>;
  modalOpen: Ref<boolean>;
  language: Ref<string>;
  errorMessage: Ref<string>;
  isTranscribing: Ref<boolean>;
  isModelReady: Ref<boolean>;
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
  const toast = useToast();
  const runtimeConfig = useRuntimeConfig();

  const fastcatApiUrl = computed(() => {
    if (options.fastcatAccountApiUrl) {
      return typeof options.fastcatAccountApiUrl === 'string'
        ? options.fastcatAccountApiUrl
        : options.fastcatAccountApiUrl.value;
    }
    return typeof runtimeConfig.public.fastcatAccountApiUrl === 'string'
      ? runtimeConfig.public.fastcatAccountApiUrl
      : '';
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

  const isModelReady = computed(() => {
    const isLocal = workspaceStore.userSettings.integrations.stt.provider === 'local';
    return isLocal ? workspaceStore.isSttModelDownloaded : Boolean(sttConfig.value);
  });

  function isTranscribableMediaFile(entry: FsEntry): boolean {
    if (entry.kind !== 'file' || entry.source === 'remote') return false;
    const mediaType = getMediaTypeFromFilename(entry.name);

    return (
      (mediaType === 'audio' || mediaType === 'video') &&
      isModelReady.value &&
      Boolean(workspaceStore.workspaceHandle) &&
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
    if (!entry || entry.kind !== 'file' || !workspaceStore.workspaceHandle) {
      return;
    }

    isTranscribing.value = true;
    errorMessage.value = '';

    try {
      const mediaType = getMediaTypeFromFilename(entry.name);

      const workspacePath = entry.path;

      // Check if already transcribed (optional logic, but fixes 'cached' parameter mismatch)
      const existing = await loadTranscriptionSidecar(
        workspaceStore.workspaceHandle!,
        workspacePath,
      );
      if (existing) {
        modalOpen.value = false;
        if (options.onSuccess) {
          options.onSuccess({ mediaType, cached: true });
        } else {
          toast.add({
            title: t('videoEditor.fileManager.audio.transcriptionCached'),
            description: t('videoEditor.fileManager.audio.transcriptionCachedDescription'),
            color: 'success',
          });
        }
        return;
      }

      let file: File | null = null;
      if (options.vfs) {
        file = await options.vfs.getFile(entry.path);
      } else {
        file = await projectStore.getFileByPath(entry.path);
      }

      if (!file) {
        throw new Error('Failed to access file');
      }

      const defaultTitle = `Transcription: ${entry.name}`;
      await runTranscriptionTask({
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
      if (options.onSuccess) {
        options.onSuccess({ mediaType, cached: false });
      } else {
        toast.add({
          title: t('videoEditor.fileManager.audio.transcriptionCompleted'),
          description:
            mediaType === 'video'
              ? t('videoEditor.fileManager.audio.transcriptionSavedVideoDescription')
              : t('videoEditor.fileManager.audio.transcriptionSavedDescription'),
          color: 'success',
        });
      }
    } catch (error: unknown) {
      if (
        (error as Error).name === 'AbortError' ||
        (error as Error).message === 'Transcription cancelled'
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to transcribe media';
      errorMessage.value = message;
      if (options.onError) {
        options.onError(message);
      } else {
        toast.add({
          title: t('videoEditor.fileManager.audio.transcriptionFailed'),
          description: message,
          color: 'error',
        });
      }
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
    isModelReady,
    pendingEntry,
    isTranscribableMediaFile,
    openModal,
    closeModal,
    submitTranscription,
  };
}
