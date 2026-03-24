import { ref, computed, watch } from 'vue';
import type { Ref } from 'vue';
import { useFilesPageStore } from '~/stores/files-page.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManagerThumbnails } from '~/composables/fileManager/useFileManagerThumbnails';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { formatBytes } from '~/utils/format';
import { getMimeTypeFromFilename } from '~/utils/media-types';
import PQueue from 'p-queue';

export interface ExtendedFsEntry extends FsEntry {
  size?: number;
  mimeType?: string;
  created?: number;
  objectUrl?: string;
}

const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];

export function useFileBrowserEntries({
  isRemoteMode,
  vfs,
}: {
  isRemoteMode: Ref<boolean>;
  vfs: IFileSystemAdapter;
}) {
  const filesPageStore = useFilesPageStore();
  const uiStore = useUiStore();
  const projectStore = useProjectStore();

  const folderEntries = ref<FsEntry[]>([]);
  const folderSizes = ref<Record<string, number>>({});
  const folderSizesLoading = ref<Record<string, boolean>>({});
  const sizeCalcQueue = new PQueue({ concurrency: 5 });

  async function calculateFolderSize(path: string, handle?: FileSystemDirectoryHandle) {
    if (folderSizes.value[path] !== undefined || folderSizesLoading.value[path]) return;

    folderSizesLoading.value[path] = true;
    await sizeCalcQueue.add(async () => {
      try {
        const resolvedHandle = handle ?? (await projectStore.getDirectoryHandleByPath(path));
        if (!resolvedHandle) return;
        let totalSize = 0;

        async function calc(dirHandle: FileSystemDirectoryHandle) {
          // @ts-expect-error Types for FileSystemDirectoryHandle values iterator may be incomplete
          for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
              try {
                const file = await entry.getFile();
                totalSize += file.size;
              } catch {
                // skip
              }
            } else if (entry.kind === 'directory') {
              await calc(entry);
            }
          }
        }

        await calc(resolvedHandle);
        folderSizes.value[path] = totalSize;
      } catch (error) {
        console.error('Failed to calculate folder size:', error);
      } finally {
        folderSizesLoading.value[path] = false;
      }
    });
  }

  async function createPreviewUrl(name: string, file: File): Promise<string | undefined> {
    const ext = name.split('.').pop()?.toLowerCase();
    if (!ext || !SUPPORTED_IMAGE_EXTS.includes(ext)) return undefined;
    try {
      return URL.createObjectURL(file);
    } catch {
      return undefined;
    }
  }

  async function supplementEntries(entries: FsEntry[]): Promise<ExtendedFsEntry[]> {
    return Promise.all(
      entries.map(async (entry) => {
        if (entry.kind === 'file') {
          try {
            const file = entry.path ? await vfs.getFile(entry.path) : null;
            if (!file) return { ...entry, size: 0, mimeType: 'unknown' };
            const objectUrl = await createPreviewUrl(entry.name, file);
            return {
              ...entry,
              size: file.size,
              mimeType: getMimeTypeFromFilename(entry.name),
              lastModified: file.lastModified,
              created: file.lastModified,
              objectUrl,
            };
          } catch {
            return { ...entry, size: 0, mimeType: 'unknown' };
          }
        }
        return { ...entry, size: 0, mimeType: 'folder' };
      }),
    );
  }

  function cleanupObjectUrls() {
    for (const entry of folderEntries.value as ExtendedFsEntry[]) {
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
  }

  const sortedEntries = computed(() => {
    const arr = [...folderEntries.value] as ExtendedFsEntry[];
    const { field, order } = filesPageStore.sortOption;
    const modifier = order === 'asc' ? 1 : -1;

    const compare = (a: string | number, b: string | number) => {
      if (a === b) return 0;
      return a > b ? modifier : -modifier;
    };

    const getSortValue = (entry: ExtendedFsEntry): string | number => {
      switch (field) {
        case 'name':
          return entry.name.toLowerCase();
        case 'type':
          return entry.kind === 'directory' ? 'folder' : (entry.mimeType ?? '');
        case 'size':
          return entry.size ?? 0;
        case 'modified':
          return entry.lastModified ?? 0;
        case 'created':
          return entry.created ?? 0;
        default:
          return entry.name.toLowerCase();
      }
    };

    return arr.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'directory' ? -1 : 1;
      }

      const result = compare(getSortValue(a), getSortValue(b));
      if (result !== 0) {
        return result;
      }

      return compare(a.name.toLowerCase(), b.name.toLowerCase());
    });
  });

  const { thumbnails: videoThumbnails } = useFileManagerThumbnails(sortedEntries);

  const stats = computed(() => {
    let totalSize = 0;
    let fileCount = 0;
    for (const entry of folderEntries.value as ExtendedFsEntry[]) {
      if (entry.kind === 'file') {
        totalSize += entry.size || 0;
        fileCount++;
      } else if (entry.kind === 'directory' && entry.path) {
        totalSize += folderSizes.value[entry.path] || 0;
      }
    }
    return { totalSize: formatBytes(totalSize), fileCount };
  });

  // Calculate size for directories in list view
  watch(
    () => [folderEntries.value, filesPageStore.viewMode],
    () => {
      if (isRemoteMode.value) return;
      if (filesPageStore.viewMode === 'list' && folderEntries.value.length > 0) {
        for (const entry of folderEntries.value) {
          if (
            entry.kind === 'directory' &&
            entry.path &&
            folderSizes.value[entry.path] === undefined &&
            !folderSizesLoading.value[entry.path]
          ) {
            void calculateFolderSize(entry.path);
          }
        }
      }
    },
    { immediate: true },
  );

  return {
    folderEntries,
    folderSizes,
    folderSizesLoading,
    sortedEntries,
    videoThumbnails,
    stats,
    calculateFolderSize,
    supplementEntries,
    cleanupObjectUrls,
  };
}
