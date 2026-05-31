import { createDevLogger } from '~/utils/dev-logger';
import { ref, watch, inject, onScopeDispose } from 'vue';
import type { Ref } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFileManagerThumbnails } from '~/composables/file-manager/useFileManagerThumbnails';
import { useFileManagerCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import { useFileSorting } from '~/composables/file-manager/useFileSorting';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getMimeTypeFromFilename } from '~/utils/media-types';
import { MAX_COPY_DEPTH } from '~/file-manager/core/rules';
import PQueue from 'p-queue';
const log = createDevLogger('useFileBrowserEntries');

export interface ExtendedFsEntry extends FsEntry {
  size?: number;
  mimeType?: string;
  created?: number;
}

export function useFileBrowserEntries({
  isRemoteMode,
  vfs,
}: {
  isRemoteMode: Ref<boolean>;
  vfs: IFileSystemAdapter;
}) {
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();
  const folderEntries = ref<FsEntry[]>([]);
  const folderSizes = ref<Record<string, number>>({});
  const folderSizesLoading = ref<Record<string, boolean>>({});
  const sizeCalcQueue = new PQueue({ concurrency: 5 });
  const metadataQueue = new PQueue({ concurrency: 20 });

  onScopeDispose(() => {
    sizeCalcQueue.clear();
    sizeCalcQueue.pause();
    metadataQueue.clear();
    metadataQueue.pause();
  });

  async function calculateFolderSize(path: string) {
    if (folderSizes.value[path] !== undefined || folderSizesLoading.value[path]) return;

    folderSizesLoading.value[path] = true;
    await sizeCalcQueue.add(async () => {
      try {
        let totalSize = 0;
        let visitedEntries = 0;
        const maxEntries = 10000;

        async function calc(dirPath: string, depth = 0) {
          if (depth > MAX_COPY_DEPTH || visitedEntries >= maxEntries) return;
          const entries = await vfs.readDirectory(dirPath);
          for (const entry of entries) {
            visitedEntries++;
            if (visitedEntries >= maxEntries) return;
            if (entry.kind === 'file') {
              try {
                const metadata = await vfs.getMetadata(entry.path);
                if (metadata?.kind === 'file') totalSize += metadata.size;
              } catch {
                // skip
              }
            } else if (entry.kind === 'directory') {
              await calc(entry.path, depth + 1);
            }
          }
        }

        await calc(path);
        folderSizes.value[path] = totalSize;
      } catch (error) {
        log.error('Failed to calculate folder size:', error);
      } finally {
        folderSizesLoading.value[path] = false;
      }
    });
  }

  async function supplementEntries(entries: FsEntry[]): Promise<ExtendedFsEntry[]> {
    return Promise.all(
      entries.map(
        (entry) =>
          metadataQueue.add(async () => {
            if (entry.kind === 'file') {
              try {
                const metadata = await vfs.getMetadata(entry.path);
                if (!metadata || metadata.kind !== 'file') {
                  return { ...entry, size: 0, mimeType: 'unknown' };
                }
                return {
                  ...entry,
                  size: metadata.size,
                  mimeType: getMimeTypeFromFilename(entry.name),
                  lastModified: metadata.lastModified,
                  created: metadata.lastModified,
                };
              } catch {
                return { ...entry, size: 0, mimeType: 'unknown' };
              }
            }
            return { ...entry, size: 0, mimeType: 'folder' };
          }) as Promise<ExtendedFsEntry>,
      ),
    );
  }

  const { sortedEntries } = useFileSorting(folderEntries, folderSizes);

  const { thumbnails: videoThumbnails } = useFileManagerThumbnails(sortedEntries, vfs);
  const { compatibility: fileCompatibility } = useFileManagerCompatibility(sortedEntries, {
    getFileByPath: (path) => vfs.getFile(path),
  });

  // Calculate size for directories in list view
  watch(
    () => [folderEntries.value, fileManagerStore.viewMode],
    () => {
      if (isRemoteMode.value) return;
      if (fileManagerStore.viewMode === 'list' && folderEntries.value.length > 0) {
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
    fileCompatibility,
    calculateFolderSize,
    supplementEntries,
  };
}
