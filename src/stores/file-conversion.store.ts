import { defineStore } from 'pinia';
import { ref, computed, shallowRef } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useFileConversionSettings } from '~/composables/file-conversion/useFileConversionSettings';

export const useFileConversionStore = defineStore('file-conversion', () => {
  const isModalOpen = ref(false);
  const isConverting = ref(false);
  const isExtractingMetadata = ref(false);
  const conversionError = ref('');
  const conversionWarnings = ref<string[]>([]);
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

  return {
    isModalOpen,
    isConverting,
    isExtractingMetadata,
    conversionError,
    conversionWarnings,
    targetEntry,
    targetIsExternal,
    targetVfs,
    targetReloadDirectory,
    mediaType,
    sourceHasAudio,
    isCancelRequested,
    conversionModalRequestId,

    // Grouped settings
    video,
    audio,
    image,
  };
});
