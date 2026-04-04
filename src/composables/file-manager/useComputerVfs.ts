import { ref, computed, shallowRef } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TauriFileSystemAdapter } from '~/file-manager/core/vfs/tauri.adapter';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';
import type { IFileSystemAdapter, VfsEntry } from '~/file-manager/core/vfs/types';


export function useComputerVfs() {
  const workspaceStore = useWorkspaceStore();
  const isTauri = workspaceStore.workspaceProviderId === 'tauri';

  const vfs = shallowRef<IFileSystemAdapter | null>(null);
  const rootPath = ref('');

  if (isTauri) {
    const isWindows = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
    
    if (isWindows) {
      // In Tauri Windows, readdir('/') might not work to list drives.
      // We'll use a blank-base adapter and start at C:/. 
      // A more complex implementation could loop through A-Z to find active drives.
      vfs.value = new TauriFileSystemAdapter('');
      rootPath.value = 'C:/'; 
    } else {
      // Unix: Root is /
      vfs.value = new TauriFileSystemAdapter('/');
      rootPath.value = '/';
    }
  } else {
    // OPFS: Root of the origin
    vfs.value = new OpfsFileSystemAdapter(async () => {
      if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
        return await navigator.storage.getDirectory();
      }
      return null;
    });
    rootPath.value = '';
  }

  return {
    vfs,
    rootPath,
    isTauri,
  };
}

