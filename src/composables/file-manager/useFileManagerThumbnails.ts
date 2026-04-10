import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { fileThumbnailGenerator, getFileThumbnailHash } from '~/utils/file-thumbnail-generator';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { FileSystemAdapter } from '~/file-manager/core/vfs/types';

const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];

export function useFileManagerThumbnails(entries: Ref<FsEntry[]>, vfs?: FileSystemAdapter) {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const thumbnails = ref<Record<string, string>>({}); // projectRelativePath -> objectUrl
  let isUnmounted = false;
  const activeHashes = new Set<string>();
  const activeImageUrls = new Map<string, string>(); // path -> objectUrl

  function cleanupAll() {
    activeHashes.forEach((hash) => {
      fileThumbnailGenerator.cancelTask(hash);
    });
    activeHashes.clear();

    activeImageUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    activeImageUrls.clear();
  }

  watch(
    entries,
    async (currentEntries) => {
      const projectId = projectStore.currentProjectId;
      const workspaceHandle = useWorkspaceStore().workspaceHandle;

      const newHashes = new Set<string>();
      const validPaths = new Set(currentEntries.map((e) => e.path).filter(Boolean));

      // 1. Cleanup thumbnails for entries no longer in currentEntries
      Object.keys(thumbnails.value).forEach((path) => {
        if (!validPaths.has(path)) {
          const url = thumbnails.value[path];
          if (activeImageUrls.has(path)) {
            URL.revokeObjectURL(activeImageUrls.get(path)!);
            activeImageUrls.delete(path);
          }
          delete thumbnails.value[path];
        }
      });

      // 2. Add tasks for new entries
      for (const entry of currentEntries) {
        if (entry.kind === 'file' && entry.path) {
          const path = entry.path;
          const type = getMediaTypeFromFilename(entry.name);
          const isTimeline = entry.name.toLowerCase().endsWith('.otio');

          // Skip if already has thumbnail
          if (thumbnails.value[path]) continue;

          if (projectId && workspaceHandle && (type === 'video' || isTimeline)) {
            // Timeline previews are NOT supported in external FM (without projectId context)
            // But here we have projectId, so it's likely the project FM or a compatible view.
            if (mediaStore.metadataLoadFailed[path]) {
              // Re-check failed metadata if we are rendering it again
              void mediaStore.getOrFetchMetadataByPath(path);
              continue;
            }

            const hash = getFileThumbnailHash({
              projectId,
              projectRelativePath: path,
            });
            newHashes.add(hash);

            activeHashes.add(hash);
            fileThumbnailGenerator.addTask({
              id: hash,
              projectId,
              projectRelativePath: path,
              onComplete: (url: string) => {
                if (isUnmounted) return;
                thumbnails.value = {
                  ...thumbnails.value,
                  [path]: url,
                };
              },
            });
          } else if (vfs && type === 'image') {
            const ext = entry.name.split('.').pop()?.toLowerCase();
            if (ext && SUPPORTED_IMAGE_EXTS.includes(ext)) {
              try {
                const file = await vfs.getFile(path);
                if (file && !isUnmounted) {
                  // Verify if the image can actually be displayed
                  try {
                    const bitmap = await createImageBitmap(file);
                    bitmap.close();

                    const url = URL.createObjectURL(file);
                    activeImageUrls.set(path, url);
                    thumbnails.value = {
                      ...thumbnails.value,
                      [path]: url,
                    };
                  } catch {
                    // Not a valid or supported image, don't generate thumbnail
                    console.warn('Image file is corrupt or not displayable:', path);
                  }
                }
              } catch (e) {
                console.warn('Failed to get image file for thumbnail:', path, e);
              }
            }
          }
        }
      }

      // Cancel tasks for files that are no longer in the list
      for (const oldHash of activeHashes) {
        if (!newHashes.has(oldHash)) {
          fileThumbnailGenerator.cancelTask(oldHash);
          activeHashes.delete(oldHash);
        }
      }
    },
    { immediate: true, deep: true },
  );

  onBeforeUnmount(() => {
    isUnmounted = true;
    cleanupAll();
  });

  return {
    thumbnails,
  };
}
