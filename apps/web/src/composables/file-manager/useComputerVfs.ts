import { ref, shallowRef } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TauriFileSystemAdapter } from '~/file-manager/core/vfs/tauri.adapter';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

/**
 * Builds an ad-hoc adapter rooted at the *current* workspace handle/path,
 * **without** the router or shared routes (`@common`, `/vardata`, `/remote`).
 *
 * This composable exists for views that want to browse only the user's
 * workspace directly (e.g. a "Computer" panel) and should NOT be used to
 * read or write project files — for that, use `useVfs()` so that you go
 * through the routed default adapter wired by the Nuxt VFS plugin.
 */
export function useComputerVfs() {
  const workspaceStore = useWorkspaceStore();
  const isTauri = workspaceStore.workspaceProviderId === 'tauri';

  const vfs = shallowRef<IFileSystemAdapter | null>(null);
  const rootPath = ref('');

  if (isTauri) {
    const workspacePath = (workspaceStore.workspaceHandle as unknown as { path?: string })?.path;
    const adapter = new TauriFileSystemAdapter(async () => {
      if (workspacePath) {
        return { type: 'absolute', path: workspacePath };
      }

      const { documentDir, homeDir } = await import('@tauri-apps/api/path');
      return {
        type: 'absolute',
        path: (await homeDir().catch(() => null)) ?? (await documentDir()),
      };
    });
    // Tauri adapter needs init() to mkdir its root.
    adapter.init().catch(() => {});
    vfs.value = adapter;
  } else {
    vfs.value = new OpfsFileSystemAdapter(async () => {
      if (workspaceStore.workspaceHandle) {
        return workspaceStore.workspaceHandle as FileSystemDirectoryHandle;
      }
      if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
        return await navigator.storage.getDirectory();
      }
      return null;
    });
  }

  return {
    vfs,
    rootPath,
    isTauri,
  };
}
