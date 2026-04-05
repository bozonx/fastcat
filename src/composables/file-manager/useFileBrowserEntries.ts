import { ref, computed, watch, inject } from 'vue';
import type { Ref } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManagerThumbnails } from '~/composables/file-manager/useFileManagerThumbnails';
import { useFileManagerCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import { useFileSorting } from '~/composables/file-manager/useFileSorting';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { getMimeTypeFromFilename } from '~/utils/media-types';
import PQueue from 'p-queue';

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
  const fileManagerStore = (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) || useFileManagerStore();
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

  async function supplementEntries(entries: FsEntry[]): Promise<ExtendedFsEntry[]> {
    return Promise.all(
      entries.map(async (entry) => {
        if (entry.kind === 'file') {
          try {
            const metadata = await vfs.getMetadata(entry.path);
            if (!metadata || metadata.kind !== 'file')
              return { ...entry, size: 0, mimeType: 'unknown' };
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
      }),
    );
  }

  const { sortedEntries } = useFileSorting(folderEntries, folderSizes);

  const { thumbnails: videoThumbnails } = useFileManagerThumbnails(sortedEntries, vfs);
  const { compatibility: fileCompatibility } = useFileManagerCompatibility(sortedEntries);

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
