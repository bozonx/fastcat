import { defineNuxtPlugin } from 'nuxt/app';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';
import { RouterFileSystemAdapter } from '~/file-manager/core/vfs/router.adapter';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TauriFileSystemAdapter } from '~/file-manager/core/vfs/tauri.adapter';
import { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import {
  WORKSPACE_COMMON_PATH_PREFIX,
  toWorkspaceCommonStoragePath,
} from '~/utils/workspace-common';

export default defineNuxtPlugin(async () => {
  let adapter: IFileSystemAdapter;

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  if (isTauri) {
    // В будущем здесь можно передавать базовый путь, например, директорию документов
    const workspaceStore = useWorkspaceStore();
    const handle = workspaceStore.workspaceHandle as unknown as TauriDirectoryHandle;
    adapter = new TauriFileSystemAdapter(handle?.path || 'app-data');
  } else {
    // Дефолтный веб-подход на базе OPFS
    const projectStore = useProjectStore();
    const workspaceStore = useWorkspaceStore();

    const projectAdapter = new OpfsFileSystemAdapter(async () => {
      return await projectStore.getProjectDirHandle();
    });

    const workspaceAdapter = new OpfsFileSystemAdapter(async () => {
      return workspaceStore.workspaceHandle ?? null;
    });

    adapter = new RouterFileSystemAdapter(projectAdapter, [
      {
        prefix: WORKSPACE_COMMON_PATH_PREFIX,
        adapter: workspaceAdapter,
        stripPrefix: toWorkspaceCommonStoragePath,
      },
    ]);
  }

  await adapter.init();

  return {
    provide: {
      vfs: adapter,
    },
  };
});
