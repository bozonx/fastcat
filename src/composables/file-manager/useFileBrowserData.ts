import type { Ref } from 'vue';
import { useFileSorting } from '~/composables/file-manager/useFileSorting';
import { useFileManagerThumbnails } from '~/composables/file-manager/useFileManagerThumbnails';
import { useFileManagerCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export function useFileBrowserData(entries: Ref<FsEntry[]>, vfs: IFileSystemAdapter) {
  const { sortedEntries } = useFileSorting(entries);
  const { thumbnails } = useFileManagerThumbnails(sortedEntries, vfs);
  const { compatibility: fileCompatibility } = useFileManagerCompatibility(sortedEntries, {
    getFileByPath: (path: string) => vfs.getFile(path),
  });

  return {
    sortedEntries,
    thumbnails,
    fileCompatibility,
  };
}
