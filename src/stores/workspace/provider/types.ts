import type { DirectoryHandleLike } from '~/repositories/fastcat-fs.repository';

export interface WorkspaceStorageProvider {
  id: string;
  isSupported: boolean;
  openWorkspace(): Promise<DirectoryHandleLike | null>;
  restoreWorkspace(): Promise<DirectoryHandleLike | null>;
  saveWorkspace(handle: DirectoryHandleLike): Promise<void>;
  clearWorkspace(): Promise<void>;
}
