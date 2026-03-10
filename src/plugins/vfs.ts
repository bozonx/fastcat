import { defineNuxtPlugin } from 'nuxt/app';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TauriFileSystemAdapter } from '~/file-manager/core/vfs/tauri.adapter';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export default defineNuxtPlugin(async () => {
  let adapter: IFileSystemAdapter;

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  if (isTauri) {
    // В будущем здесь можно передавать базовый путь, например, директорию документов
    adapter = new TauriFileSystemAdapter('app-data');
  } else {
    // Дефолтный веб-подход на базе OPFS
    const projectStore = useProjectStore();
    const workspaceStore = useWorkspaceStore();
    adapter = new OpfsFileSystemAdapter(
      async () => {
        return await projectStore.getProjectDirHandle();
      },
      async () => {
        return workspaceStore.workspaceHandle ?? null;
      },
    );
  }

  // Можно инициализировать адаптер при необходимости
  // await adapter.init();

  return {
    provide: {
      vfs: adapter,
    },
  };
});
