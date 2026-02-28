export interface WorkspaceHandleStorage<THandle = FileSystemDirectoryHandle> {
  get(): Promise<THandle | null>;
  set(handle: THandle): Promise<void>;
  clear(): Promise<void>;
}

interface IndexedDbLike {
  open(name: string, version?: number): IDBOpenDBRequest;
}

export function createIndexedDbWorkspaceHandleStorage(input: {
  indexedDB: IndexedDbLike;
  dbName?: string;
  storeName?: string;
  key?: string;
}): WorkspaceHandleStorage {
  const dbName = input.dbName ?? 'GranVideoEditor';
  const storeName = input.storeName ?? 'handles';
  const key = input.key ?? 'workspace';

  async function openDb(): Promise<IDBDatabase> {
    const request = input.indexedDB.open(dbName, 1);

    request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };

    return await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore<T>(params: {
    mode: IDBTransactionMode;
    fn: (store: IDBObjectStore) => IDBRequest<T>;
  }): Promise<T> {
    const db = await openDb();
    try {
      const tx = db.transaction(storeName, params.mode);
      const store = tx.objectStore(storeName);
      const req = params.fn(store);

      return await new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  return {
    async get() {
      try {
        const result = await withStore({ mode: 'readonly', fn: (store) => store.get(key) });
        return (result as FileSystemDirectoryHandle | null) ?? null;
      } catch {
        return null;
      }
    },

    async set(handle) {
      await withStore({
        mode: 'readwrite',
        fn: (store) => store.put(handle as unknown as FileSystemDirectoryHandle, key),
      });
    },

    async clear() {
      await withStore({ mode: 'readwrite', fn: (store) => store.delete(key) });
    },
  };
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
