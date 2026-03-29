import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { fileThumbnailGenerator, getFileThumbnailHash } from '~/utils/file-thumbnail-generator';
import { getMediaTypeFromFilename } from '~/utils/media-types';

export function useFileManagerThumbnails(entries: Ref<FsEntry[]>) {
  const projectStore = useProjectStore();
  const thumbnails = ref<Record<string, string>>({}); // projectRelativePath -> objectUrl
  let isUnmounted = false;
  const activeHashes = new Set<string>();

  function cleanupAll() {
    activeHashes.forEach((hash) => {
      fileThumbnailGenerator.cancelTask(hash);
    });
    activeHashes.clear();
  }

  watch(
    entries,
    (currentEntries) => {
      if (!projectStore.currentProjectId) {
        thumbnails.value = {};
        cleanupAll();
        return;
      }

      const projectId = projectStore.currentProjectId;
      const newHashes = new Set<string>();
      const validPaths = new Set(currentEntries.map((e) => e.path).filter(Boolean));

      // 1. Cleanup thumbnails for entries no longer in currentEntries
      Object.keys(thumbnails.value).forEach((path) => {
        if (!validPaths.has(path)) {
          delete thumbnails.value[path];
        }
      });

      // 2. Add tasks for new entries
      for (const entry of currentEntries) {
        if (entry.kind === 'file' && entry.path) {
          const path = entry.path;
          const type = getMediaTypeFromFilename(entry.name);
          const isTimeline = entry.name.toLowerCase().endsWith('.otio');

          if (type === 'video' || isTimeline) {
            const hash = getFileThumbnailHash({
              projectId,
              projectRelativePath: path,
            });
            newHashes.add(hash);

            if (!thumbnails.value[path]) {
              activeHashes.add(hash);
              fileThumbnailGenerator.addTask({
                id: hash,
                projectId,
                projectRelativePath: path,
                onComplete: (url: string) => {
                  if (isUnmounted) return;
                  // Use spread to trigger reactivity
                  thumbnails.value = {
                    ...thumbnails.value,
                    [path]: url,
                  };
                },
              });
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
