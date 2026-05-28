import { createDevLogger } from '~/utils/dev-logger';
import type { WorkspaceProvider } from './types';
import type { DirectoryHandleLike } from '~/repositories/app-fs.repository';
import type { WorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';
import { exists } from '@tauri-apps/plugin-fs';
import { TauriDirectoryHandle } from './tauri-handle';
import { isTauriRuntime } from '~/utils/runtime';
import { resolveTauriAppPaths } from '~/utils/tauri-paths';
const log = createDevLogger('tauri');

function isForbiddenPathError(error: unknown): boolean {
  if (typeof error === 'string') {
    return error.includes('forbidden path:');
  }
  if (error instanceof Error) {
    return error.message.includes('forbidden path:');
  }
  return false;
}

export class TauriWorkspaceProvider implements WorkspaceProvider {
  id = 'tauri';
  isSupported = isTauriRuntime();

  constructor(
    private storage: WorkspaceHandleStorage<string>,
    private fastcatDevDir?: string,
  ) {}

  async openWorkspace(): Promise<DirectoryHandleLike | null> {
    return await this.restoreWorkspace();
  }

  async restoreWorkspace(): Promise<DirectoryHandleLike | null> {
    if (!this.isSupported) return null;

    try {
      await this.storage.clear().catch(log.warn);
      const path = await this.resolveDefaultWorkspacePath();
      if (!path) return null;

      let dirExists: boolean;
      try {
        dirExists = await exists(path);
      } catch (error) {
        if (isForbiddenPathError(error)) return null;
        throw error;
      }

      if (!dirExists) {
        const { mkdir } = await import('@tauri-apps/plugin-fs');
        await mkdir(path, { recursive: true });
      }

      const { basename } = await import('@tauri-apps/api/path');
      const name = await basename(path);
      return new TauriDirectoryHandle(path, name || 'workspace') as unknown as DirectoryHandleLike;
    } catch (e) {
      log.warn('Failed to restore tauri workspace handle:', e);
    }
    return null;
  }

  private async resolveDefaultWorkspacePath(): Promise<string | null> {
    const paths = await resolveTauriAppPaths(this.fastcatDevDir);
    if (!paths) return null;

    const { join } = await import('@tauri-apps/api/path');
    return await join(paths.documentsDir, 'FastCat');
  }

  async saveWorkspace(_handle: DirectoryHandleLike): Promise<void> {
    await this.storage.clear().catch(log.warn);
  }

  async clearWorkspace(): Promise<void> {
    await this.storage.clear().catch(log.warn);
  }
}
