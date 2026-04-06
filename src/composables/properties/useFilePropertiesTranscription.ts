import { computed, ref, watch, type Ref } from 'vue';
import { getMimeTypeFromFilename } from '~/utils/media-types';
import { runTranscriptionTask } from '~/utils/transcription/task-wrapper';
import type { FastCatUserSettings } from '~/utils/settings';
import type { FsEntry } from '~/types/fs';

interface UseFilePropertiesTranscriptionOptions {
  selectedFsEntry: Ref<FsEntry>;
  isAudioFile: Ref<boolean>;
  isVideoFile: Ref<boolean>;
  sttConfig: Ref<unknown>;
  workspaceHandle: Ref<FileSystemDirectoryHandle | null | undefined>;
  userSettings: Ref<FastCatUserSettings>;
  fastcatAccountApiUrl: Ref<string>;
  currentProjectName: Ref<string | null>;
  getFileByPath: (path: string) => Promise<File | null | undefined>;
  isSttModelDownloaded: Ref<boolean>;
  toast: { add: (payload: { title: string; description?: string; color?: string }) => void };
  t: (key: string, ...args: any[]) => string;
}

function extractTranscriptionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';

  const data = payload as Record<string, unknown>;
  for (const key of ['text', 'formattedText', 'transcript']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const result = data.result;
  if (result && typeof result === 'object') {
    return extractTranscriptionText(result);
  }

  return '';
}

export function useFilePropertiesTranscription(options: UseFilePropertiesTranscriptionOptions) {
  const isTranscriptionModalOpen = ref(false);
  const transcriptionLanguage = ref('');
  const isTranscribingAudio = ref(false);
  const transcriptionError = ref('');
  const latestTranscriptionText = ref('');

  const isSttModelReady = computed(() => {
    const isLocal = options.userSettings.value.integrations.stt.provider === 'local';
    return isLocal ? options.isSttModelDownloaded.value : Boolean(options.sttConfig.value);
  });

  const canTranscribeMedia = computed(() => {
    const entry = options.selectedFsEntry.value;
    
    return (
      entry?.kind === 'file' &&
      entry?.source !== 'remote' &&
      (options.isAudioFile.value || options.isVideoFile.value) &&
      isSttModelReady.value &&
      Boolean(options.workspaceHandle.value) &&
      Boolean(entry.path)
    );
  });

  function resetTranscriptionState() {
    transcriptionLanguage.value = '';
    transcriptionError.value = '';
    latestTranscriptionText.value = '';
    isTranscriptionModalOpen.value = false;
    isTranscribingAudio.value = false;
  }

  function openTranscriptionModal() {
    if (!canTranscribeMedia.value) return;
    transcriptionLanguage.value = options.userSettings.value.integrations.stt.language || '';
    transcriptionError.value = '';
    isTranscriptionModalOpen.value = true;
  }

  async function submitAudioTranscription() {
    const selectedEntry = options.selectedFsEntry.value;
    if (
      !options.workspaceHandle.value
    ) {
      return;
    }

    isTranscribingAudio.value = true;
    transcriptionError.value = '';

    try {
      const file = await options.getFileByPath(selectedEntry.path);
      if (!file) throw new Error('Failed to access file');

      const workspacePath = selectedEntry.path.startsWith('/') || selectedEntry.path.startsWith('projects/') || !options.currentProjectName.value
        ? selectedEntry.path
        : `projects/${options.currentProjectName.value}/${selectedEntry.path}`;

      isTranscriptionModalOpen.value = false;
      const result = await runTranscriptionTask({
        file,
        filePath: workspacePath,
        fileName: selectedEntry.name,
        fileType: getMimeTypeFromFilename(selectedEntry.name),
        language: transcriptionLanguage.value,
        fastcatAccountApiUrl: options.fastcatAccountApiUrl.value,
        userSettings: options.userSettings.value,
        workspaceHandle: options.workspaceHandle.value,
        title: options.t('videoEditor.backgroundTasks.transcriptionTitle', { name: selectedEntry.name }),
      } as any);

      latestTranscriptionText.value = extractTranscriptionText(result.record.response);

      options.toast.add({
        title: options.t(
          'videoEditor.fileManager.audio.transcriptionCompleted',
          'Transcription completed',
        ),
        description: options.t(
          'videoEditor.fileManager.audio.transcriptionFinishedDescription',
          'Transcription for {name} has been completed successfully.',
          { name: selectedEntry.name }
        ),
        color: 'success',
      });
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError' || (error as Error).message === 'Transcription cancelled') {
        return;
      }
      transcriptionError.value =
        error instanceof Error
          ? error.message
          : options.t(
              'videoEditor.fileManager.audio.transcriptionAudioFailed',
              'Failed to transcribe audio',
            );
    } finally {
      isTranscribingAudio.value = false;
    }
  }

  watch(
    () => options.selectedFsEntry.value?.path,
    () => {
      resetTranscriptionState();
    },
    { immediate: true },
  );

  return {
    canTranscribeMedia,
    isTranscriptionModalOpen,
    transcriptionLanguage,
    isTranscribingAudio,
    transcriptionError,
    latestTranscriptionText,
    isSttModelReady,
    openTranscriptionModal,
    submitAudioTranscription,
  };
}
