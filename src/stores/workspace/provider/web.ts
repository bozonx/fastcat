import { createDevLogger } from '~/utils/dev-logger';
import { requestPersistentStorage } from '~/composables/useStoragePersistence';
import type { WorkspaceProvider } from './types';
import type { DirectoryHandleLike } from '~/repositories/app-fs.repository';
import type { WorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';
const log = createDevLogger('web');

export const WEB_WORKSPACE_NAME_STORAGE_KEY = 'fastcat_web_workspace_name';
export const DEFAULT_WEB_WORKSPACE_NAME = 'fastcat-workspace';

function getWebWorkspaceName(): string {
  if (typeof window === 'undefined') return DEFAULT_WEB_WORKSPACE_NAME;
  const value = window.localStorage.getItem(WEB_WORKSPACE_NAME_STORAGE_KEY)?.trim();
  return value || DEFAULT_WEB_WORKSPACE_NAME;
}

export class WebWorkspaceProvider implements WorkspaceProvider {
  id = 'web';
  isSupported =
    typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

  constructor(private storage: WorkspaceHandleStorage<FileSystemDirectoryHandle>) {}

  async openWorkspace(): Promise<DirectoryHandleLike | null> {
    return await this.restoreWorkspace();
  }

  async restoreWorkspace(): Promise<DirectoryHandleLike | null> {
    if (!this.isSupported) return null;

    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getDirectoryHandle(getWebWorkspaceName(), { create: true });
      await this.storage.set(handle);
      // Best-effort: ask the browser to keep this OPFS sandbox from being evicted
      // under storage pressure. Fire-and-forget — never block workspace open.
      void requestPersistentStorage();
      return handle;
    } catch (e) {
      log.warn('Failed to restore OPFS web workspace:', e);
    }
    return null;
  }

  async saveWorkspace(handle: DirectoryHandleLike): Promise<void> {
    await this.storage.set(handle as FileSystemDirectoryHandle);
  }

  async clearWorkspace(): Promise<void> {
    await this.storage.clear().catch(log.warn);
  }
}
