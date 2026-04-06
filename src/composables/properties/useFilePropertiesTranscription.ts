import { computed, ref, watch, type Ref } from 'vue';
import { createTranscriptionCacheRepository } from '~/repositories/transcription-cache.repository';
import { getMimeTypeFromFilename } from '~/utils/media-types';
import { transcribeAudioFile } from '~/utils/transcription/engine';
import type { FastCatUserSettings } from '~/utils/settings';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
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
  toast: { add: (payload: { title: string; description?: string; color?: string }) => void };
  t: (key: string, fallback?: string) => string;
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
  const latestTranscriptionCacheKey = ref('');
  const latestTranscriptionWasCached = ref(false);

  const canTranscribeMedia = computed(() => {
    const entry = options.selectedFsEntry.value;
    const isLocal = options.userSettings.value.integrations.stt.provider === 'local';
    
    return (
      entry?.kind === 'file' &&
      entry?.source !== 'remote' &&
      (options.isAudioFile.value || options.isVideoFile.value) &&
      (isLocal || Boolean(options.sttConfig.value)) &&
      Boolean(options.workspaceHandle.value) &&
      Boolean(entry.path)
    );
  });

  function resetTranscriptionState() {
    transcriptionLanguage.value = '';
    transcriptionError.value = '';
    latestTranscriptionText.value = '';
    latestTranscriptionCacheKey.value = '';
    latestTranscriptionWasCached.value = false;
    isTranscriptionModalOpen.value = false;
    isTranscribingAudio.value = false;
  }

  async function loadCachedTranscription() {
    const selectedEntry = options.selectedFsEntry.value;
    if (
      !selectedEntry ||
      selectedEntry.kind !== 'file' ||
      !options.workspaceHandle.value ||
      !(options.isAudioFile.value || options.isVideoFile.value)
    ) {
      latestTranscriptionText.value = '';
      latestTranscriptionCacheKey.value = '';
      latestTranscriptionWasCached.value = false;
      return;
    }

    try {
      const repository = createTranscriptionCacheRepository({
        workspaceDir: options.workspaceHandle.value,
      });
      
      const workspacePath = selectedEntry.path.startsWith('/') || selectedEntry.path.startsWith('projects/') || !options.currentProjectName.value
        ? selectedEntry.path
        : `projects/${options.currentProjectName.value}/${selectedEntry.path}`;

      const records = await repository.list({ sourcePath: workspacePath });
      const record = records[0];
      latestTranscriptionText.value = record ? extractTranscriptionText(record.response) : '';
      latestTranscriptionCacheKey.value = record?.key ?? '';
      latestTranscriptionWasCached.value = Boolean(record);
    } catch {
      latestTranscriptionText.value = '';
      latestTranscriptionCacheKey.value = '';
      latestTranscriptionWasCached.value = false;
    }
  }

  function openTranscriptionModal() {
    if (!canTranscribeMedia.value) return;
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

      const result = await transcribeAudioFile({
        file,
        filePath: workspacePath,
        fileName: selectedEntry.name,
        fileType: getMimeTypeFromFilename(selectedEntry.name),
        language: transcriptionLanguage.value,
        fastcatAccountApiUrl: options.fastcatAccountApiUrl.value,
        userSettings: options.userSettings.value,
        workspaceHandle: options.workspaceHandle.value,
      } as any);

      latestTranscriptionText.value = extractTranscriptionText(result.record.response);
      latestTranscriptionCacheKey.value = result.cacheKey;
      latestTranscriptionWasCached.value = result.cached;
      isTranscriptionModalOpen.value = false;

      options.toast.add({
        title: result.cached
          ? options.t(
              'videoEditor.fileManager.audio.transcriptionCached',
              'Using cached transcription',
            )
          : options.t(
              'videoEditor.fileManager.audio.transcriptionCompleted',
              'Transcription completed',
            ),
        description: result.cached
          ? options.t(
              'videoEditor.fileManager.audio.transcriptionCachedDescription',
              'Cached transcription was loaded from the file directory.',
            )
          : options.t(
              'videoEditor.fileManager.audio.transcriptionSavedDescription',
              'Transcription was saved next to the source file.',
            ),
        color: 'success',
      });
    } catch (error: unknown) {
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
    async () => {
      resetTranscriptionState();
      await loadCachedTranscription();
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
    latestTranscriptionCacheKey,
    latestTranscriptionWasCached,
    openTranscriptionModal,
    submitAudioTranscription,
  };
}
