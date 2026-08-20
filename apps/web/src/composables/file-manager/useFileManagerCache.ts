import { clearVectorImageRasterVfs } from '~/media-cache/application/vectorImageCache';
import type { FileManagerContext } from './fileManagerContext';

export function createFileManagerCache(ctx: FileManagerContext) {
  const { deps } = ctx;
  const timelineMediaUsageStore = deps.timelineMediaUsageStore ?? {
    refreshUsage: async () => {},
    mediaPathToTimelines: {},
  };

  async function triggerMediaIntegrityCheck() {
    await timelineMediaUsageStore.refreshUsage();
    const usedPaths = Object.keys(timelineMediaUsageStore.mediaPathToTimelines);
    await deps.mediaStore.revalidateMissingMedia(usedPaths);
  }

  async function clearVectorCacheForPath(path: string) {
    const projectId = deps.getProjectId();
    if (!projectId) return;

    await clearVectorImageRasterVfs({
      vfs: deps.vfs,
      projectId,
      projectRelativePath: path,
    });
  }

  async function clearVectorCacheForDirectory(oldPath: string, newPath: string) {
    const projectId = deps.getProjectId();
    if (!projectId) return;

    async function walk(dirPath: string): Promise<void> {
      const entries = await deps.vfs.readDirectory(dirPath);
      for (const entry of entries) {
        if (entry.kind === 'directory') {
          await walk(entry.path);
        } else {
          const oldFilePath = `${oldPath}${entry.path.slice(newPath.length)}`;
          await clearVectorImageRasterVfs({
            vfs: deps.vfs,
            projectId: projectId!,
            projectRelativePath: oldFilePath,
          });
        }
      }
    }

    try {
      await walk(newPath);
    } catch {
      // ignore
    }
  }

  ctx.triggerMediaIntegrityCheck = triggerMediaIntegrityCheck;
  ctx.clearVectorCacheForPath = clearVectorCacheForPath;
  ctx.clearVectorCacheForDirectory = clearVectorCacheForDirectory;

  return { triggerMediaIntegrityCheck, clearVectorCacheForPath, clearVectorCacheForDirectory };
}
