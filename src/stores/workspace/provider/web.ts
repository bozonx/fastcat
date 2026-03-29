import type { WorkspaceProvider } from './types';
import type { DirectoryHandleLike } from '~/repositories/fastcat-fs.repository';
import type { WorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';

export class WebWorkspaceProvider implements WorkspaceProvider {
  id = 'web';
  isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  constructor(private storage: WorkspaceHandleStorage<FileSystemDirectoryHandle>) {}

  async openWorkspace(): Promise<DirectoryHandleLike | null> {
    if (!this.isSupported) return null;

    const picker = (
      window as unknown as {
        showDirectoryPicker?: (options: {
          mode: 'readwrite' | 'readonly';
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;

    if (!picker) return null;

    const handle = await picker({ mode: 'readwrite' });
    await this.storage.set(handle);
    return handle;
  }

  async restoreWorkspace(): Promise<DirectoryHandleLike | null> {
    if (!this.isSupported) return null;

    try {
      const handle = await this.storage.get();
      if (!handle) return null;

      const handleWithPerm = handle as unknown as {
        queryPermission?: (options: {
          mode: 'readwrite' | 'readonly';
        }) => Promise<'granted' | 'denied' | 'prompt'>;
      };

      const options = { mode: 'readwrite' as const };
      if ((await handleWithPerm.queryPermission?.(options)) === 'granted') {
        return handle;
      }
    } catch (e) {
      console.warn('Failed to restore web workspace handle:', e);
    }
    return null;
  }

  async saveWorkspace(handle: DirectoryHandleLike): Promise<void> {
    await this.storage.set(handle as FileSystemDirectoryHandle);
  }

  async clearWorkspace(): Promise<void> {
    await this.storage.clear().catch(console.warn);
  }
}
