import { computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type {
  RemoteVfsEntry,
  RemoteVfsFileEntry,
  RemoteVfsDirectoryEntry,
} from '~/types/remote-vfs';
import type { BloggerDogEntryPayload } from '~/types/bloggerdog';
import {
  isBloggerDogAllContentRoot,
  isBloggerDogPersonalLibraryRoot,
  isBloggerDogProjectLibrariesRoot,
} from '~/utils/bloggerdog-file-manager';

export interface BloggerDogEntryInfoDeps {
  selectedFsEntry: () => FsEntry;
  fileInfo: Ref<{ kind?: string } | null | undefined>;
  isBloggerDogContentItem: Ref<boolean>;
  isBloggerDogGroup: Ref<boolean>;
  isBloggerDogProject: Ref<boolean>;
  isBloggerDogMedia: Ref<boolean>;
}

/**
 * BloggerDog (remote) entry classification + decoded remote record/counts used
 * by `FileProperties.vue`. Extracted as a cohesive group.
 */
export function useBloggerDogEntryInfo(deps: BloggerDogEntryInfoDeps) {
  const isVirtualAll = computed(() => isBloggerDogAllContentRoot(deps.selectedFsEntry()));
  const isPersonalLibrary = computed(() => isBloggerDogPersonalLibraryRoot(deps.selectedFsEntry()));
  const isProjectLibraries = computed(() =>
    isBloggerDogProjectLibrariesRoot(deps.selectedFsEntry()),
  );

  const isRemoteContent = computed(
    () =>
      deps.isBloggerDogContentItem.value ||
      deps.isBloggerDogGroup.value ||
      deps.isBloggerDogProject.value ||
      deps.isBloggerDogMedia.value,
  );

  const castedRemoteRecord = computed(() => {
    if (!isRemoteContent.value || !deps.selectedFsEntry()?.adapterPayload) return null;
    const payload = deps.selectedFsEntry().adapterPayload as BloggerDogEntryPayload;
    return payload?.remoteData as RemoteVfsEntry | undefined;
  });

  const remoteMediaCount = computed(() => {
    if (deps.fileInfo.value?.kind === 'file') return undefined;
    const record = castedRemoteRecord.value;
    if (record && 'media' in record) {
      return (record as RemoteVfsFileEntry).media?.length;
    }
    return undefined;
  });

  const remoteItemsCount = computed(() => {
    const record = castedRemoteRecord.value;
    if (record && 'itemsCount' in record) {
      return (record as RemoteVfsDirectoryEntry).itemsCount;
    }
    return undefined;
  });

  return {
    isVirtualAll,
    isPersonalLibrary,
    isProjectLibraries,
    isRemoteContent,
    castedRemoteRecord,
    remoteMediaCount,
    remoteItemsCount,
  };
}
