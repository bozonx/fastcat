import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useFileConversionSettings } from '~/composables/file-conversion/useFileConversionSettings';
import { useFileConversionActions } from '~/composables/file-conversion/useFileConversionActions';

export const useFileConversionStore = defineStore('file-conversion', () => {
  const isModalOpen = ref(false);
  const isConverting = ref(false);
  const conversionError = ref('');
  const targetEntry = ref<FsEntry | null>(null);
  const targetIsExternal = ref(false);
  const targetVfs = shallowRef<IFileSystemAdapter | null>(null);
  const targetReloadDirectory = shallowRef<((path: string) => Promise<void>) | null>(null);
  const isCancelRequested = ref(false);
  const conversionModalRequestId = ref(0);
  const sourceHasAudio = ref(true);

  const mediaType = computed(() => {
    if (!targetEntry.value) return null;
    return getMediaTypeFromFilename(targetEntry.value.name);
  });

  const { video, audio, image } = useFileConversionSettings();

  // Callbacks are meant to be provided by the UI layer (e.g. the modal component)
  // Store just holds the references so actions can trigger them
  const callbacks = {
    onSuccess: undefined as
      | ((type: 'bgTaskAdded' | 'success', bgTaskTitle?: string) => void)
      | undefined,
    onError: undefined as ((error: Error) => void) | undefined,
    onWarning: undefined as ((message: string) => void) | undefined,
  };

  const { openConversionModal, startConversion, cancelConversion } = useFileConversionActions({
    targetEntry,
    targetIsExternal,
    targetVfs,
    targetReloadDirectory,
    mediaType,
    videoSettings: video,
    audioSettings: audio,
    imageSettings: image,
    isCancelRequested,
    isConverting,
    conversionError,
    isModalOpen,
    conversionModalRequestId,
    sourceHasAudio,
    callbacks,
  });

  return {
    isModalOpen,
    isConverting,
    conversionError,
    targetEntry,
    targetIsExternal,
    targetVfs,
    targetReloadDirectory,
    mediaType,
    sourceHasAudio,

    // Grouped settings
    video,
    audio,
    image,

    // Actions
    openConversionModal,
    startConversion,
    cancelConversion,

    // Callbacks hook
    callbacks,
  };
});
