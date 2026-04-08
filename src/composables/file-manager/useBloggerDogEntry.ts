import { computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { BloggerDogEntryPayload, BdEntryType } from '~/types/bloggerdog';
import { getBdPayload } from '~/types/bloggerdog';

export function useBloggerDogEntry(entry: Ref<FsEntry | null>) {
  const bd = computed(() => getBdPayload(entry.value ?? {}));

  const isBloggerDog = computed(() => !!bd.value);

  const bdType = computed<BdEntryType | undefined>(() => bd.value?.type);

  const isVirtualFolder = computed(() => bdType.value === 'virtual-folder');
  const isProject = computed(() => bdType.value === 'project');
  const isCollection = computed(() => bdType.value === 'collection');
  const isContentItem = computed(() => bdType.value === 'content-item');
  const isMedia = computed(() => bdType.value === 'media');

  const thumbnailUrl = computed(() => bd.value?.thumbnailUrl ?? null);
  const mediaId = computed(() => bd.value?.mediaId);
  const remoteData = computed(() => bd.value?.remoteData);

  return {
    bd,
    isBloggerDog,
    bdType,
    isVirtualFolder,
    isProject,
    isCollection,
    isContentItem,
    isMedia,
    thumbnailUrl,
    mediaId,
    remoteData,
  };
}
