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
    
    // In Tauri, the workspace root is the path of the current workspace handle
    const workspacePath = (workspaceStore.workspaceHandle as any)?.path || '';
    
    vfs.value = new TauriFileSystemAdapter(workspacePath);
    rootPath.value = ''; 
  } else {

    // OPFS: Root of the actual workspace (embedded-editor folder)
    vfs.value = new OpfsFileSystemAdapter(async () => {
      if (workspaceStore.workspaceHandle) {
        return workspaceStore.workspaceHandle as FileSystemDirectoryHandle;
      }
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

