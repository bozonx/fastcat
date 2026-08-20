import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

/** Per-project application data directory (holds settings/meta/ui json). */
export const PROJECT_APP_DIR_NAME = '.fastcat';

/**
 * Shared construction input for project repositories.
 *
 * `projectPath` is the VFS path of the project root:
 * - `''` (default) → the *active* project (default VFS route);
 * - `@project/<name>` → a *specific* project (see {@link toProjectStoragePath}),
 *   used while creating a project that is not yet active.
 */
export interface ProjectRepositoryDeps {
  vfs: IFileSystemAdapter;
  projectPath?: string;
}

/** Build the VFS path of `filename` inside the project's app data directory. */
export function projectAppFilePath(projectPath: string | undefined, filename: string): string {
  const base = projectPath ? `${projectPath}/` : '';
  return `${base}${PROJECT_APP_DIR_NAME}/${filename}`;
}
