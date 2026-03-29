import {
  createIndexedDbWorkspaceHandleStorage,
  type WorkspaceHandleStorage,
} from '~/repositories/workspace-handle.repository';

export { createIndexedDbWorkspaceHandleStorage, type WorkspaceHandleStorage };

export async function saveWorkspaceHandleToIndexedDB(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const storage = createIndexedDbWorkspaceHandleStorage({ indexedDB: window.indexedDB });
  await storage.set(handle);
}

export async function getWorkspaceHandleFromIndexedDB(): Promise<FileSystemDirectoryHandle | null> {
  const storage = createIndexedDbWorkspaceHandleStorage({ indexedDB: window.indexedDB });
  return await storage.get();
}

export async function clearWorkspaceHandleFromIndexedDB(): Promise<void> {
  const storage = createIndexedDbWorkspaceHandleStorage({ indexedDB: window.indexedDB });
  await storage.clear();
}
