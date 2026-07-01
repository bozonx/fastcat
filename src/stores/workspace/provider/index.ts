import type { WorkspaceProvider } from './types';
import { WebWorkspaceProvider } from './web';
import { TauriWorkspaceProvider } from './tauri';
import { createInMemoryWorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';
import { isTauriRuntime } from '~/utils/runtime';

export function createWorkspaceProvider(fastcatDevDir?: string): WorkspaceProvider {
  const isTauri = isTauriRuntime();

  if (isTauri) {
    const storage = createInMemoryWorkspaceHandleStorage<string>();

    return new TauriWorkspaceProvider(storage, fastcatDevDir);
  }

  const storage = createInMemoryWorkspaceHandleStorage<FileSystemDirectoryHandle>();

  return new WebWorkspaceProvider(storage);
}

export * from './types';
