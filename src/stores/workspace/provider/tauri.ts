import type { WorkspaceProvider } from './types';
import type { DirectoryHandleLike } from '~/repositories/gran-fs';
import type { WorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';
import { open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';
import { TauriDirectoryHandle } from './tauri-handle';

export class TauriWorkspaceProvider implements WorkspaceProvider {
  id = 'tauri';
  isSupported = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  constructor(private storage: WorkspaceHandleStorage<string>) {}

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
      const path = await this.storage.get();
      if (!path) return null;

      const dirExists = await exists(path);
      if (dirExists) {
        return new TauriDirectoryHandle(
          path,
          path.split('/').pop() || path.split('\\').pop() || 'workspace',
        ) as unknown as DirectoryHandleLike;
      }
    } catch (e) {
      console.warn('Failed to restore tauri workspace handle:', e);
    }
    return null;
  }

  async saveWorkspace(handle: DirectoryHandleLike): Promise<void> {
    await this.storage.set((handle as any).path);
  }

  async clearWorkspace(): Promise<void> {
    await this.storage.clear().catch(console.warn);
  }
}
