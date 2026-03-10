import type { WorkspaceProvider } from './types';
import { WebWorkspaceProvider } from './web';
import { TauriWorkspaceProvider } from './tauri';
import { createIndexedDbWorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';

export function createWorkspaceProvider(): WorkspaceProvider {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  if (isTauri) {
    const storage =
      typeof window !== 'undefined' && window.indexedDB
        ? createIndexedDbWorkspaceHandleStorage({
            indexedDB: window.indexedDB,
            key: 'tauri-workspace-path',
          })
        : null;

    // In Tauri, we save the string path, so we need to override the type
    return new TauriWorkspaceProvider(storage as any);
  }

  const storage =
    typeof window !== 'undefined' && window.indexedDB
      ? createIndexedDbWorkspaceHandleStorage({ indexedDB: window.indexedDB })
      : null;

  return new WebWorkspaceProvider(storage as any);
}

export * from './types';
