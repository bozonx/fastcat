import { createDevLogger } from '~/utils/dev-logger';
import type { WorkspaceProvider } from './types';
import type { DirectoryHandleLike } from '~/repositories/app-fs.repository';
import type { WorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';
import { open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';
import { TauriDirectoryHandle } from './tauri-handle';
import { isTauriRuntime } from '~/utils/runtime';
import { resolveTauriAppPaths } from '~/utils/tauri-paths';
const log = createDevLogger('tauri');

export class TauriWorkspaceProvider implements WorkspaceProvider {
  id = 'tauri';
  isSupported = isTauriRuntime();

  constructor(
    private storage: WorkspaceHandleStorage<string>,
    private fastcatDevDir?: string,
  ) {}

  async openWorkspace(): Promise<DirectoryHandleLike | null> {
    if (!this.isSupported) return null;

    const selected = await open({
      directory: true,
      multiple: false,
    });

    if (selected === null) {
      return null;
    }

    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;

    await this.storage.set(path);
    return new TauriDirectoryHandle(
      path,
      path.split('/').pop() || path.split('\\').pop() || 'workspace',
    ) as unknown as DirectoryHandleLike;
  }

  async restoreWorkspace(): Promise<DirectoryHandleLike | null> {
    if (!this.isSupported) return null;

    try {
      let path = await this.storage.get();
      let isDefaultWorkspace = false;
      if (!path) {
        const paths = await resolveTauriAppPaths(this.fastcatDevDir);
        if (paths) {
          const { join } = await import('@tauri-apps/api/path');
          path = await join(paths.documentsDir, 'FastCat');
          isDefaultWorkspace = true;
        } else {
          return null;
        }
      }

      const dirExists = await exists(path);
      if (!dirExists) {
        if (isDefaultWorkspace || path.endsWith('FastCat')) {
          const { mkdir } = await import('@tauri-apps/plugin-fs');
          await mkdir(path, { recursive: true }).catch(() => undefined);
          await this.storage.set(path);
        } else {
          return null;
        }
      }

      return new TauriDirectoryHandle(
        path,
        path.split('/').pop() || path.split('\\').pop() || 'workspace',
      ) as unknown as DirectoryHandleLike;
    } catch (e) {
      log.warn('Failed to restore tauri workspace handle:', e);
    }
    return null;
  }

  async saveWorkspace(handle: DirectoryHandleLike): Promise<void> {
    await this.storage.set((handle as unknown as { path: string }).path);
  }

  async clearWorkspace(): Promise<void> {
    await this.storage.clear().catch(log.warn);
  }
}
