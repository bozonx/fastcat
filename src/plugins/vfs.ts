import { defineNuxtPlugin } from 'nuxt/app';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';
import { RouterFileSystemAdapter } from '~/file-manager/core/vfs/router.adapter';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TauriFileSystemAdapter } from '~/file-manager/core/vfs/tauri.adapter';
import type { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { BloggerDogVfsAdapter } from '~/file-manager/core/vfs/bloggerdog.adapter';
import { useBloggerDogStore } from '~/stores/bloggerdog';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  WORKSPACE_COMMON_PATH_PREFIX,
  toWorkspaceCommonStoragePath,
} from '~/utils/workspace-common';

export default defineNuxtPlugin(async (nuxtApp) => {
  const translate = (key: string, def?: string) => {
    const i18n = (nuxtApp as any).$i18n;
    if (!i18n) return def ?? key;
    return i18n.t(key) || def || key;
  };

  let adapter: IFileSystemAdapter;

  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  if (isTauri) {
    const handle = workspaceStore.workspaceHandle as unknown as TauriDirectoryHandle;
    const workspacePath = handle?.path || 'app-data';

    const projectAdapter = new TauriFileSystemAdapter(async () => {
      const projectHandle = await projectStore.getProjectDirHandle();
      return (projectHandle as unknown as TauriDirectoryHandle)?.path || workspacePath;
    });

    const workspaceAdapter = new TauriFileSystemAdapter(workspacePath);

    adapter = new RouterFileSystemAdapter(projectAdapter, [
      {
        prefix: WORKSPACE_COMMON_PATH_PREFIX,
        adapter: workspaceAdapter,
        stripPrefix: toWorkspaceCommonStoragePath,
      },
      {
        prefix: '/vardata',
        adapter: workspaceAdapter,
        stripPrefix: (p) => (p.startsWith('/') ? p.slice(1) : p),
      },
      {
        prefix: '/remote',
        adapter: new BloggerDogVfsAdapter(() => {
          const bloggerDogStore = useBloggerDogStore();
          return bloggerDogStore.config;
        }, translate),
        stripPrefix: (p) => (p.startsWith('/remote') ? p.slice('/remote'.length) : p),
      },
    ]);
  } else {
    // Дефолтный веб-подход на базе OPFS
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
      {
        prefix: '/vardata',
        adapter: workspaceAdapter,
        stripPrefix: (p) => (p.startsWith('/') ? p.slice(1) : p),
      },
      {
        prefix: '/remote',
        adapter: new BloggerDogVfsAdapter(() => {
          const bloggerDogStore = useBloggerDogStore();
          return bloggerDogStore.config;
        }, translate),
        stripPrefix: (p) => (p.startsWith('/remote') ? p.slice('/remote'.length) : p),
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
