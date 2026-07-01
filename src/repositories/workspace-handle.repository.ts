export interface WorkspaceHandleStorage<THandle = FileSystemDirectoryHandle> {
  get(): Promise<THandle | null>;
  set(handle: THandle): Promise<void>;
  clear(): Promise<void>;
}

export function createInMemoryWorkspaceHandleStorage<
  THandle = FileSystemDirectoryHandle,
>(): WorkspaceHandleStorage<THandle> {
  let value: THandle | null = null;
  return {
    async get() {
      return value;
    },
    async set(handle) {
      value = handle;
    },
    async clear() {
      value = null;
    },
  };
}
