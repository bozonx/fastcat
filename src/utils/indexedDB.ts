export async function saveWorkspaceHandleToIndexedDB(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const request = indexedDB.open('GranVideoEditor', 1);
  request.onupgradeneeded = (e: any) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('handles')) {
      db.createObjectStore('handles');
    }
  };

  return new Promise<void>((resolve, reject) => {
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readwrite');
      const store = tx.objectStore('handles');
      store.put(handle, 'workspace');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getWorkspaceHandleFromIndexedDB(): Promise<FileSystemDirectoryHandle | null> {
  const request = indexedDB.open('GranVideoEditor', 1);
  request.onupgradeneeded = (e: any) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('handles')) {
      db.createObjectStore('handles');
    }
  };

  return new Promise((resolve) => {
    request.onsuccess = (e: any) => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      const getReq = store.get('workspace');
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

export async function clearWorkspaceHandleFromIndexedDB(): Promise<void> {
  const request = indexedDB.open('GranVideoEditor', 1);
  request.onsuccess = (e: any) => {
    const db = e.target.result;
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('workspace');
  };
}
