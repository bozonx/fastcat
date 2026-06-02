import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  FILE_MANAGER_THUMBNAILS,
  MARKER_THUMBNAILS,
  TIMELINE_MANAGER_THUMBNAILS,
} from '~/utils/constants';
import {
  BaseThumbnailGenerator,
  type BaseThumbnailTask,
  hashString,
} from './base-thumbnail-generator';
import { useVfs } from '~/composables/useVfs';
import { toProjectTempVfsPath } from '~/utils/storage-topology';
import { getThumbnailWorkerClient, setThumbnailHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { isTauriRuntime } from '~/utils/runtime';
import {
  getNativeFileHandlePath,
  nativeMediaMetadata,
  nativeVideoFrameWebp,
} from '~/utils/tauri-media-processing';
const log = createDevLogger('file-thumbnail-generator');

export interface FileThumbnailTask extends BaseThumbnailTask {
  onComplete?: (url: string) => void;
  onError?: (err: Error) => void;
}

export function getFileThumbnailHash(input: {
  projectId: string;
  projectRelativePath: string;
  source?: {
    size: number;
    lastModified: number;
  };
}): string {
  const isTimeline = input.projectRelativePath.toLowerCase().endsWith('.otio');
  const sourceKey = (input.source && !isTimeline) ? `:${input.source.size}:${input.source.lastModified}` : '';
  return hashString(`file:${input.projectId}:${input.projectRelativePath}${sourceKey}`);
}

function getThumbnailDirVfsPath(input: { projectId: string; dirName: string }): string {
  return toProjectTempVfsPath(input.projectId, ['thumbnails', input.dirName]);
}

function getThumbnailFileVfsPath(input: {
  projectId: string;
  dirName: string;
  fileName: string;
}): string {
  return `${getThumbnailDirVfsPath(input)}/${input.fileName}`;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ((error as { name?: unknown }).name === 'NotFoundError' ||
      (error as { name?: unknown }).name === 'VfsNotFoundError')
  );
}

async function resizeImage(file: File, maxWidth: number, maxHeight: number): Promise<Blob> {
  const imageBitmap = await createImageBitmap(file);
  try {
    let width = imageBitmap.width;
    let height = imageBitmap.height;

    if (width > maxWidth || height > maxHeight) {
      if (width > height) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      } else {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }
    }

    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context for image resize');
    ctx.drawImage(imageBitmap, 0, 0, width, height);

    let blob: Blob | null = null;
    if (canvas instanceof OffscreenCanvas) {
      blob = await canvas.convertToBlob({
        type: 'image/webp',
        quality: FILE_MANAGER_THUMBNAILS.QUALITY,
      });
    } else {
      blob = await new Promise<Blob | null>((resolve) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => resolve(b),
          'image/webp',
          FILE_MANAGER_THUMBNAILS.QUALITY,
        );
      });
    }

    if (!blob) throw new Error('Failed to generate image thumbnail blob');
    return blob;
  } finally {
    imageBitmap.close();
  }
}

class FileThumbnailGenerator extends BaseThumbnailGenerator<FileThumbnailTask, string> {
  // File thumbnails are small webp images (~30-60 KB); 500 entries ≈ 15-30 MB,
  // which is fine and keeps revocations rare so consumers don't observe broken URLs.
  protected maxCacheEntries = 500;
  private cacheProjectIds = new Map<string, string>();

  protected get taskPriority(): number {
    return MEDIA_TASK_PRIORITIES.fileThumbnail;
  }

  protected revokeCacheValue(url: string): void {
    URL.revokeObjectURL(url);
  }

  protected override evictCacheIfNeeded() {
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) return;
      const value = this.cache.get(oldestKey);
      if (value) {
        this.revokeCacheValue(value);
      }
      this.cache.delete(oldestKey);
      this.cacheProjectIds.delete(oldestKey);
    }
  }

  protected override clearAdditionalState(): void {
    this.cacheProjectIds.clear();
  }

  protected onCacheHit(task: FileThumbnailTask, url: string): void {
    task.onComplete?.(url);
  }

  private async loadThumbnailFromVfs(task: FileThumbnailTask): Promise<string | null> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return null;

    try {
      const vfs = useVfs();
      const isTimeline = task.projectRelativePath.toLowerCase().endsWith('.otio');
      const dirName = isTimeline
        ? TIMELINE_MANAGER_THUMBNAILS.DIR_NAME
        : FILE_MANAGER_THUMBNAILS.DIR_NAME;
      const filePath = getThumbnailFileVfsPath({
        projectId: task.projectId,
        dirName,
        fileName: `${task.id}.webp`,
      });

      const blob = await vfs.readFile(filePath);
      const url = URL.createObjectURL(blob);

      const previousUrl = this.cache.get(task.id);
      if (previousUrl && previousUrl !== url) {
        this.revokeCacheValue(previousUrl);
      }
      this.cache.set(task.id, url);
      this.cacheProjectIds.set(task.id, task.projectId);
      this.touchCacheEntry(task.id);
      this.evictCacheIfNeeded();
      return url;
    } catch (e) {
      if (!isNotFoundError(e)) {
        log.warn('Failed to load file thumbnail from VFS', task.id, e);
      }
      return null;
    }
  }

  protected async executeTask(task: FileThumbnailTask): Promise<void> {
    const existingUrl = await this.loadThumbnailFromVfs(task);
    if (existingUrl) {
      if (!this.isCancelled(task.id)) {
        task.onComplete?.(existingUrl);
      }
      return;
    }

    if (this.isCancelled(task.id)) return;

    const workspaceStore = useWorkspaceStore();
    const projectStore = useProjectStore();

    if (!workspaceStore.workspaceHandle) {
      throw new Error('Workspace is not opened');
    }

    // If it's a timeline file, we don't have an automatic generator for it.
    // We expect it to be saved manually during project save.
    if (task.projectRelativePath.toLowerCase().endsWith('.otio')) return;

    const file = await projectStore.getFileByPath(task.projectRelativePath);
    if (!file) {
      task.onError?.(new Error(`Source file not found: ${task.projectRelativePath}`));
      return;
    }

    const type = getMediaTypeFromFilename(task.projectRelativePath);
    let blob: Blob | null = null;

    if (type === 'image') {
      try {
        blob = await resizeImage(
          file,
          FILE_MANAGER_THUMBNAILS.MAX_SIZE,
          FILE_MANAGER_THUMBNAILS.MAX_SIZE,
        );
      } catch (e) {
        if (!this.isCancelled(task.id)) {
          task.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
        return;
      }
    } else {
      if (isTauriRuntime()) {
        const handle = await projectStore.getFileHandleByPath(task.projectRelativePath);
        const sourcePath = getNativeFileHandlePath(handle);
        if (sourcePath) {
          try {
            const meta = await nativeMediaMetadata(sourcePath);
            const timeSec = Math.max(
              0,
              (meta.duration || 0) * FILE_MANAGER_THUMBNAILS.POSITION_FRACTION,
            );
            blob = await nativeVideoFrameWebp({
              sourcePath,
              timeSec,
              maxWidth: FILE_MANAGER_THUMBNAILS.MAX_SIZE,
              maxHeight: FILE_MANAGER_THUMBNAILS.MAX_SIZE,
              quality: FILE_MANAGER_THUMBNAILS.QUALITY,
            });
          } catch (e) {
            if (!this.isCancelled(task.id)) {
              task.onError?.(e instanceof Error ? e : new Error(String(e)));
            }
            return;
          }
        } else {
          // No native path available — cannot generate thumbnail in Tauri without web worker.
          return;
        }
      } else {

        setThumbnailHostApi(
          createVideoCoreHostApi({
            getCurrentProjectId: () => projectStore.currentProjectId,
            getWorkspaceHandle: () => workspaceStore.workspaceHandle,
            getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
            getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
            getFileByPath: async (path) => projectStore.getFileByPath(path),
            onExportProgress: () => {},
          }),
        );

        const { client } = getThumbnailWorkerClient();

        try {
          const blobs = await client.extractVideoFrameBlobs(file, {
            timesS: [FILE_MANAGER_THUMBNAILS.POSITION_FRACTION],
            maxWidth: FILE_MANAGER_THUMBNAILS.MAX_SIZE,
            maxHeight: FILE_MANAGER_THUMBNAILS.MAX_SIZE,
            quality: FILE_MANAGER_THUMBNAILS.QUALITY,
            mimeType: 'image/webp',
            taskId: task.id,
            keepAlive: false,
          });
          blob = blobs[0] ?? null;
        } catch (e) {
          if (!this.isCancelled(task.id)) {
            task.onError?.(e instanceof Error ? e : new Error(String(e)));
          }
          return;
        }
      }
    }

    if (!blob || this.isCancelled(task.id)) return;

    const vfs = useVfs();
    const filePath = getThumbnailFileVfsPath({
      projectId: task.projectId,
      dirName: FILE_MANAGER_THUMBNAILS.DIR_NAME,
      fileName: `${task.id}.webp`,
    });
    await vfs.writeFile(filePath, blob);

    const thumbUrl = URL.createObjectURL(blob);

    const previousUrl = this.cache.get(task.id);
    if (previousUrl && previousUrl !== thumbUrl) {
      this.revokeCacheValue(previousUrl);
    }
    this.cache.set(task.id, thumbUrl);
    this.cacheProjectIds.set(task.id, task.projectId);
    this.touchCacheEntry(task.id);
    this.evictCacheIfNeeded();

    if (!this.isCancelled(task.id)) {
      task.onComplete?.(thumbUrl);
    }
  }

  async saveManualThumbnail(input: { projectId: string; projectRelativePath: string; blob: Blob }) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    const hash = hashString(`file:${input.projectId}:${input.projectRelativePath}`);
    const isTimeline = input.projectRelativePath.toLowerCase().endsWith('.otio');
    const dirName = isTimeline
      ? TIMELINE_MANAGER_THUMBNAILS.DIR_NAME
      : FILE_MANAGER_THUMBNAILS.DIR_NAME;

    const vfs = useVfs();
    const filePath = getThumbnailFileVfsPath({
      projectId: input.projectId,
      dirName,
      fileName: `${hash}.webp`,
    });
    await vfs.writeFile(filePath, input.blob);

    const thumbUrl = URL.createObjectURL(input.blob);

    const previousUrl = this.cache.get(hash);
    if (previousUrl && previousUrl !== thumbUrl) {
      this.revokeCacheValue(previousUrl);
    }
    this.cache.set(hash, thumbUrl);
    this.cacheProjectIds.set(hash, input.projectId);
    this.touchCacheEntry(hash);
    this.evictCacheIfNeeded();
  }

  async clearThumbnail(input: { projectId: string; projectRelativePath: string }) {
    const hash = hashString(`file:${input.projectId}:${input.projectRelativePath}`);
    const cachedUrl = this.cache.get(hash);
    if (cachedUrl) {
      this.revokeCacheValue(cachedUrl);
      this.cache.delete(hash);
      this.cacheProjectIds.delete(hash);
    }

    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const isTimeline = input.projectRelativePath.toLowerCase().endsWith('.otio');
      const dirName = isTimeline
        ? TIMELINE_MANAGER_THUMBNAILS.DIR_NAME
        : FILE_MANAGER_THUMBNAILS.DIR_NAME;
      const vfs = useVfs();
      const filePath = getThumbnailFileVfsPath({
        projectId: input.projectId,
        dirName,
        fileName: `${hash}.webp`,
      });

      await vfs.deleteEntry(filePath);
    } catch (e) {
      if (!isNotFoundError(e)) {
        log.warn('Failed to clear file thumbnail for', hash, e);
      }
    }
  }

  async getMarkerThumbnail(input: {
    projectId: string;
    markerId: string;
    timeUs: number;
  }): Promise<string | null> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return null;

    const cacheKey = `marker:${input.markerId}`;

    try {
      const vfs = useVfs();
      const dirPath = getThumbnailDirVfsPath({
        projectId: input.projectId,
        dirName: MARKER_THUMBNAILS.DIR_NAME,
      });

      const prefix = `${input.markerId}_`;
      const expectedFileName = `${prefix}${input.timeUs}.webp`;
      const expectedPath = `${dirPath}/${expectedFileName}`;

      let foundBlob: Blob | null = null;
      try {
        foundBlob = await vfs.readFile(expectedPath);
      } catch (e) {
        if (!isNotFoundError(e)) throw e;
      }

      if (!foundBlob) {
        // Fall back to scan (and cleanup) only when the exact file is missing —
        // this is the case where the marker's timeUs changed since last save.
        const entries = await vfs.readDirectory(dirPath);
        for (const entry of entries) {
          if (entry.kind === 'file' && entry.name.startsWith(prefix)) {
            await vfs.deleteEntry(`${dirPath}/${entry.name}`).catch(() => {});
          }
        }
      }

      if (foundBlob) {
        const url = URL.createObjectURL(foundBlob);
        const previousUrl = this.cache.get(cacheKey);
        if (previousUrl && previousUrl !== url) {
          this.revokeCacheValue(previousUrl);
        }
        this.cache.set(cacheKey, url);
        this.cacheProjectIds.set(cacheKey, input.projectId);
        return url;
      }
    } catch (e) {
      if (!isNotFoundError(e)) {
        log.warn('Failed to get marker thumbnail from VFS', input.markerId, e);
      }
    }

    return null;
  }

  async saveMarkerThumbnail(input: {
    projectId: string;
    markerId: string;
    timeUs: number;
    blob: Blob;
  }) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const vfs = useVfs();
      const filePath = getThumbnailFileVfsPath({
        projectId: input.projectId,
        dirName: MARKER_THUMBNAILS.DIR_NAME,
        fileName: `${input.markerId}_${input.timeUs}.webp`,
      });
      await vfs.writeFile(filePath, input.blob);

      const url = URL.createObjectURL(input.blob);
      const cacheKey = `marker:${input.markerId}`;
      const previousUrl = this.cache.get(cacheKey);
      if (previousUrl && previousUrl !== url) {
        this.revokeCacheValue(previousUrl);
      }
      this.cache.set(cacheKey, url);
      this.cacheProjectIds.set(cacheKey, input.projectId);
    } catch (e) {
      log.error('Failed to save marker thumbnail to VFS', input.markerId, e);
    }
  }

  async clearAllThumbnails(projectId: string) {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const vfs = useVfs();
      const projectThumbnailsPath = toProjectTempVfsPath(projectId, ['thumbnails']);
      await vfs.deleteEntry(projectThumbnailsPath, true);

      for (const [key, cachedUrl] of this.cache.entries()) {
        if (this.cacheProjectIds.get(key) !== projectId) continue;
        this.revokeCacheValue(cachedUrl);
        this.cache.delete(key);
        this.cacheProjectIds.delete(key);
      }
    } catch (e) {
      if (!isNotFoundError(e)) {
        log.warn('Failed to clear all file thumbnails for project', projectId, e);
      }
    }
  }
}

export const fileThumbnailGenerator = new FileThumbnailGenerator();
// See thumbnail-generator.ts — exported separately to avoid a Vite transform
// quirk with `export class` on a generic heritage clause.
export { FileThumbnailGenerator };
