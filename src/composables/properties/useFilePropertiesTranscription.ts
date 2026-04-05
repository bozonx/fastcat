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
  currentProjectId: Ref<string | null | undefined>;
  resolvedStorageTopology: Ref<ResolvedStorageTopology>;
  userSettings: Ref<FastCatUserSettings>;
  bloggerDogApiUrl: Ref<string>;
  fastcatAccountApiUrl: Ref<string>;
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
    return (
      entry?.kind === 'file' &&
      entry?.source !== 'remote' &&
      (options.isAudioFile.value || options.isVideoFile.value) &&
      Boolean(options.sttConfig.value) &&
      Boolean(options.workspaceHandle.value) &&
      Boolean(options.currentProjectId.value) &&
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
      !options.currentProjectId.value ||
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
        topology: options.resolvedStorageTopology.value,
        projectId: options.currentProjectId.value,
      });
      const records = await repository.list();
      const record = records.find((item) => item.sourcePath === selectedEntry.path);
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
      !selectedEntry ||
      selectedEntry.kind !== 'file' ||
      !options.workspaceHandle.value ||
      !options.currentProjectId.value
    ) {
      return;
    }

    isTranscribingAudio.value = true;
    transcriptionError.value = '';

    try {
      const file = await options.getFileByPath(selectedEntry.path);
      if (!file) throw new Error('Failed to access file');

      const result = await transcribeAudioFile({
        file,
        filePath: selectedEntry.path,
        fileName: selectedEntry.name,
        fileType: getMimeTypeFromFilename(selectedEntry.name),
        language: transcriptionLanguage.value,
        bloggerDogApiUrl: options.bloggerDogApiUrl.value,
        fastcatAccountApiUrl: options.fastcatAccountApiUrl.value,
        projectId: options.currentProjectId.value,
        userSettings: options.userSettings.value,
        workspaceHandle: options.workspaceHandle.value,
        resolvedStorageTopology: options.resolvedStorageTopology.value,
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
              'Cached transcription was loaded from vardata.',
            )
          : options.t(
              'videoEditor.fileManager.audio.transcriptionSavedDescription',
              'Transcription was saved to vardata cache.',
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
