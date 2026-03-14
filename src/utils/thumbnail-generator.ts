import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import {
  BaseThumbnailGenerator,
  type BaseThumbnailTask,
  ensureBaseThumbnailDir,
  hashString,
} from './base-thumbnail-generator';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';

export interface ThumbnailTask extends BaseThumbnailTask {
  duration: number; // video duration in seconds
  onProgress?: (progress: number, url: string, time: number) => void;
  onComplete?: () => void;
  onError?: (err: Error) => void;
}

export function getClipThumbnailsHash(input: {
  projectId: string;
  projectRelativePath: string;
}): string {
  return hashString(`${input.projectId}:${input.projectRelativePath}`);
}

async function ensureTimelineThumbnailDir(input: {
  projectId: string;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  hash?: string;
  create?: boolean;
}): Promise<FileSystemDirectoryHandle> {
  const leafSegments = input.hash
    ? ['thumbnails', TIMELINE_CLIP_THUMBNAILS.DIR_NAME, input.hash]
    : ['thumbnails', TIMELINE_CLIP_THUMBNAILS.DIR_NAME];

  return await ensureBaseThumbnailDir({
    projectId: input.projectId,
    workspaceStore: input.workspaceStore,
    leafSegments,
    create: input.create,
  });
}

class ThumbnailGenerator extends BaseThumbnailGenerator<ThumbnailTask, string[]> {
  protected maxCacheEntries = 50;

  protected get concurrencyLimit(): number {
    const workspaceStore = useWorkspaceStore();
    return workspaceStore.userSettings?.optimization?.mediaTaskConcurrency || 2;
  }

  protected revokeCacheValue(urls: string[]): void {
    // Note: URL revocation is now handled by the consumers (components)
    // to avoid UI breaking when cache evicts an actively displayed thumbnail.
    // For now, we do nothing here.
  }

  protected onCacheHit(task: ThumbnailTask, urls: string[]): void {
    urls.forEach((url, index) => {
      const time = index * TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS;
      task.onProgress?.((index + 1) / urls.length, url, time);
    });
    task.onComplete?.();
  }

  private async loadThumbnailsFromOPFS(task: ThumbnailTask): Promise<boolean> {
    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return false;

    try {
      const hashDir = await ensureTimelineThumbnailDir({
        projectId: task.projectId,
        workspaceStore,
        hash: task.id,
      });

      const urls: string[] = [];
      const totalFrames = Math.ceil(task.duration / TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS);
      let framesProcessed = 0;

      // We expect filenames to be "0.webp", "5.webp", "10.webp", etc.
      for (let i = 0; i <= task.duration; i += TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS) {
        if (this.isCancelled(task.id)) {
          return true; // Cancelled
        }
        const fileName = `${Math.round(i)}.webp`;
        try {
          const fileHandle = await hashDir.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          const buffer = await file.arrayBuffer();
          const blob = new Blob([buffer], { type: file.type });
          const url = URL.createObjectURL(blob);
          urls.push(url);
          framesProcessed++;
          if (!this.isCancelled(task.id)) {
            task.onProgress?.(framesProcessed / totalFrames, url, i);
          }
        } catch (e: any) {
          if (e?.name === 'NotFoundError') {
            // If any frame is missing, we consider OPFS cache incomplete
            return false;
          }
          throw e;
        }
      }

      if (this.isCancelled(task.id)) {
        return true;
      }

      this.cache.set(task.id, urls);
      this.touchCacheEntry(task.id);
      this.evictCacheIfNeeded();
      task.onComplete?.();
      return true;
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to load thumbnails from OPFS', task.id, e);
      }
      return false;
    }
  }

  protected async executeTask(task: ThumbnailTask): Promise<void> {
    const isLoaded = await this.loadThumbnailsFromOPFS(task);
    if (isLoaded) return;

    if (this.isCancelled(task.id)) return;

    const workspaceStore = useWorkspaceStore();
    const projectStore = useProjectStore();

    if (!workspaceStore.workspaceHandle) {
      throw new Error('Workspace is not opened');
    }

    const file = await projectStore.getFileByPath(task.projectRelativePath);
    if (!file) throw new Error(`Source file not found: ${task.projectRelativePath}`);

    const timesS: number[] = [];
    for (let t = 0; t <= task.duration; t += TIMELINE_CLIP_THUMBNAILS.INTERVAL_SECONDS) {
      timesS.push(t);
    }

    if (timesS.length === 0) return;

    const totalFrames = timesS.length;

    setExportHostApi(
      createVideoCoreHostApi({
        getCurrentProjectId: () => projectStore.currentProjectId,
        getWorkspaceHandle: () => workspaceStore.workspaceHandle,
        getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
        getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
        getFileByPath: async (path) => projectStore.getFileByPath(path),
        onExportProgress: () => {},
      }),
    );

    const { client } = getExportWorkerClient();

    const blobs = await client.extractVideoFrameBlobs(file, {
      timesS,
      maxWidth: TIMELINE_CLIP_THUMBNAILS.WIDTH,
      maxHeight: TIMELINE_CLIP_THUMBNAILS.HEIGHT,
      quality: TIMELINE_CLIP_THUMBNAILS.QUALITY,
      mimeType: 'image/webp',
    });

    if (this.isCancelled(task.id)) return;

    const dir = await ensureTimelineThumbnailDir({
      projectId: task.projectId,
      workspaceStore,
      hash: task.id,
      create: true,
    });

    let framesProcessed = 0;
    for (let i = 0; i < timesS.length; i++) {
      if (this.isCancelled(task.id)) return;

      const blob = blobs[i];
      const currentTime = timesS[i]!;

      if (!blob) continue;

      const fileName = `${Math.round(currentTime)}.webp`;
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(blob);
      await writable.close();

      const thumbUrl = URL.createObjectURL(blob);

      const urls = this.cache.get(task.id) ?? [];
      urls.push(thumbUrl);
      this.cache.set(task.id, urls);
      this.touchCacheEntry(task.id);
      this.evictCacheIfNeeded();

      framesProcessed++;
      if (!this.isCancelled(task.id)) {
        task.onProgress?.(framesProcessed / totalFrames, thumbUrl, currentTime);
      }
    }

    if (!this.isCancelled(task.id)) {
      task.onComplete?.();
    }
  }

  async clearThumbnails(input: { projectId: string; hash: string }) {
    this.cache.delete(input.hash);

    const workspaceStore = useWorkspaceStore();
    if (!workspaceStore.workspaceHandle) return;

    try {
      const dir = await ensureTimelineThumbnailDir({
        projectId: input.projectId,
        workspaceStore,
        create: true,
      });

      await dir.removeEntry(input.hash, { recursive: true });
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') {
        console.warn('Failed to clear thumbnails for', input.hash, e);
      }
    }
  }
}

export const thumbnailGenerator = new ThumbnailGenerator();
