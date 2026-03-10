import type { DirectoryHandleLike } from '~/repositories/gran-fs';

export interface WorkspaceProvider {
  id: string;
  isSupported: boolean;
  openWorkspace(): Promise<DirectoryHandleLike | null>;
  restoreWorkspace(): Promise<DirectoryHandleLike | null>;
  clearWorkspace(): Promise<void>;
}
