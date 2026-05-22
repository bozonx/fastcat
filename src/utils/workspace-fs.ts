import { useWorkspaceStore } from '~/stores/workspace.store';

/**
 * Resolves a FileSystemFileHandle for a project-relative path within the
 * current workspace. Returns null if the workspace handle is unavailable or
 * the path cannot be resolved.
 */
export async function getWorkspaceFileHandle(
  path: string,
  options?: { create?: boolean },
): Promise<FileSystemFileHandle | null> {
  const workspaceStore = useWorkspaceStore();
  const workspaceHandle = workspaceStore.workspaceHandle;
  if (!workspaceHandle) return null;

  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return null;

  try {
    let currentDir = workspaceHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, {
        create: options?.create ?? false,
      });
    }

    return await currentDir.getFileHandle(fileName, {
      create: options?.create ?? false,
    });
  } catch {
    return null;
  }
}
