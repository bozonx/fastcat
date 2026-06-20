import { storeToRefs } from 'pinia';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileConversionActions } from '~/composables/file-conversion/useFileConversionActions';

export function useFileConversionStoreActions(
  store: ReturnType<typeof useFileConversionStore>,
  fileManager: ReturnType<typeof useFileManager>,
) {
  const {
    targetEntry,
    targetIsExternal,
    targetVfs,
    targetReloadDirectory,
    mediaType,
    isCancelRequested,
    isConverting,
    isExtractingMetadata,
    conversionError,
    conversionWarnings,
    isModalOpen,
    conversionModalRequestId,
    sourceHasAudio,
  } = storeToRefs(store);

  return useFileConversionActions({
    targetEntry,
    targetIsExternal,
    targetVfs,
    targetReloadDirectory,
    mediaType,
    videoSettings: store.video,
    audioSettings: store.audio,
    imageSettings: store.image,
    isCancelRequested,
    isConverting,
    isExtractingMetadata,
    conversionError,
    conversionWarnings,
    isModalOpen,
    conversionModalRequestId,
    sourceHasAudio,
    fileManager,
  });
}
