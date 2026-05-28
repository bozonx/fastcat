import type { WorkspaceProvider } from './types';
import { WebWorkspaceProvider } from './web';
import { TauriWorkspaceProvider } from './tauri';
import { createIndexedDbWorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';
import { isTauriRuntime } from '~/utils/runtime';

export function createWorkspaceProvider(fastcatDevDir?: string): WorkspaceProvider {
  const isTauri = isTauriRuntime();

  if (isTauri) {
    const storage =
      typeof window !== 'undefined' && window.indexedDB
        ? createIndexedDbWorkspaceHandleStorage({
            indexedDB: window.indexedDB,
            key: 'tauri-workspace-path',
          })
        : null;

    // In Tauri, we save the string path, so we need to override the type
    return new TauriWorkspaceProvider(
      storage as unknown as import('~/repositories/workspace-handle.repository').WorkspaceHandleStorage<string>,
      fastcatDevDir,
    );
  }

  const storage =
    typeof window !== 'undefined' && window.indexedDB
      ? createIndexedDbWorkspaceHandleStorage({ indexedDB: window.indexedDB })
      : null;

  return new WebWorkspaceProvider(storage!);
}

export * from './types';
