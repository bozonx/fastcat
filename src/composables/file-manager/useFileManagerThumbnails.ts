import { createDevLogger } from '~/utils/dev-logger';
import { ref, watch, onScopeDispose, type Ref } from 'vue';
import { safeRevokeObjectURL } from '~/composables/useSafeObjectUrl';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { fileThumbnailGenerator, getFileThumbnailHash } from '~/utils/file-thumbnail-generator';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
const log = createDevLogger('useFileManagerThumbnails');

const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];

function resolveMetadataCacheKey(entry: FsEntry): string | null {
  if (!entry.path) return null;
  if (entry.source === 'remote') return `external:${entry.path}`;
  if (entry.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry.path)) {
    return `external:${entry.path}`;
  }
  return entry.path;
}

function getSourceFingerprint(entry: FsEntry): { size: number; lastModified: number } | undefined {
  if (typeof entry.size !== 'number' || typeof entry.lastModified !== 'number') return undefined;
  return {
    size: entry.size,
    lastModified: entry.lastModified,
  };
}

export function useFileManagerThumbnails(entries: Ref<FsEntry[]>, vfs?: IFileSystemAdapter) {
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
      safeRevokeObjectURL(url);
    });
    activeImageUrls.clear();
  }

  watch(
    entries,
    async (currentEntries) => {
      const workspaceStore = useWorkspaceStore();
      const projectId = projectStore.currentProjectId;

      // When the user has disabled thumbnail generation globally, skip video decoding
      // for file manager thumbnails too — it prevents unnecessary heavy Worker work.
      const thumbnailsDisabled = workspaceStore.userSettings?.ui?.clipThumbnailMode === 'none';

      const newHashes = new Set<string>();
      const validPaths = new Set(currentEntries.map((e) => e.path).filter(Boolean));

      // 1. Cleanup thumbnails for entries no longer in currentEntries
      Object.keys(thumbnails.value).forEach((path) => {
        if (!validPaths.has(path)) {
          if (activeImageUrls.has(path)) {
            safeRevokeObjectURL(activeImageUrls.get(path)!);
            activeImageUrls.delete(path);
          }
          Reflect.deleteProperty(thumbnails.value, path);
        }
      });

      // 2. Add tasks for new entries
      for (const entry of currentEntries) {
        if (entry.kind === 'file' && entry.path) {
          const path = entry.path;
          const type = getMediaTypeFromFilename(entry.name);
          const isTimeline = entry.name.toLowerCase().endsWith('.otio');
          const hasProjectContext = Boolean(projectId && workspaceStore.hasPersistentStorage);

          if (
            projectId &&
            hasProjectContext &&
            (type === 'video' || type === 'image' || isTimeline) &&
            !(thumbnailsDisabled && type === 'video')
          ) {
            // Timeline previews are NOT supported in external FM (without projectId context)
            // But here we have projectId, so it's likely the project FM or a compatible view.
            if (mediaStore.metadataLoadFailed[path]) {
              continue;
            }

            const cacheKey = resolveMetadataCacheKey(entry);
            const cachedMeta = cacheKey ? mediaStore.mediaMetadata[cacheKey] : null;
            if (cacheKey && (mediaStore.metadataLoadFailed[cacheKey] || cachedMeta?.error)) {
              continue;
            }
            if (cachedMeta?.image?.canDisplay === false) {
              continue;
            }

            const hash = getFileThumbnailHash({
              projectId,
              projectRelativePath: path,
              source: getSourceFingerprint(entry),
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
          } else if (!hasProjectContext && vfs && type === 'image') {
            // Fallback for image when project context is missing (load full file)
            if (thumbnails.value[path]) continue;
            const ext = entry.name.split('.').pop()?.toLowerCase();
            if (ext && SUPPORTED_IMAGE_EXTS.includes(ext)) {
              const cacheKey = resolveMetadataCacheKey(entry);
              const cachedMeta = cacheKey ? mediaStore.mediaMetadata[cacheKey] : null;
              if (cacheKey && (mediaStore.metadataLoadFailed[cacheKey] || cachedMeta?.error)) {
                continue;
              }
              if (cachedMeta?.image?.canDisplay === false) {
                continue;
              }

              try {
                const file = await vfs.getFile(path);
                if (file && !isUnmounted) {
                  const metadata =
                    cachedMeta ??
                    (cacheKey ? await mediaStore.getOrFetchMetadata(file, cacheKey) : null);

                  if (
                    metadata?.error ||
                    metadata?.image?.canDisplay === false ||
                    (cacheKey && mediaStore.metadataLoadFailed[cacheKey])
                  ) {
                    log.warn('Image file is corrupt or not displayable:', path);
                    continue;
                  }

                  const url = URL.createObjectURL(file);
                  activeImageUrls.set(path, url);
                  thumbnails.value = {
                    ...thumbnails.value,
                    [path]: url,
                  };
                }
              } catch (e) {
                log.warn('Failed to get image file for thumbnail:', path, e);
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

  onScopeDispose(() => {
    isUnmounted = true;
    cleanupAll();
  });

  return {
    thumbnails,
  };
}
