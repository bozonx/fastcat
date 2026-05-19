import { defineNuxtPlugin } from 'nuxt/app';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';
import { RouterFileSystemAdapter } from '~/file-manager/core/vfs/router.adapter';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  TauriFileSystemAdapter,
  TAURI_APP_DATA_BASE_PATH,
} from '~/file-manager/core/vfs/tauri.adapter';
import type { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';
import type {
  IFileSystemAdapter,
  VfsProgressHandle,
  VfsProgressReporter,
} from '~/file-manager/core/vfs/types';
import { BloggerDogVfsAdapter } from '~/file-manager/core/vfs/bloggerdog.adapter';
import { useBloggerDogStore } from '~/stores/bloggerdog';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useUiStore } from '~/stores/ui.store';
import {
  WORKSPACE_COMMON_PATH_PREFIX,
  toWorkspaceCommonStoragePath,
} from '~/utils/workspace-common';

/**
 * Bridges core VFS progress reporting to the Nuxt-side background-tasks store
 * and notification system. Keeping this here (and not inside the adapters)
 * preserves the rule that `~/file-manager/core/vfs/*` has zero knowledge of
 * Nuxt, Pinia, or i18n.
 */
function createNuxtVfsProgressReporter(nuxtApp: unknown): VfsProgressReporter {
  return {
    start(input) {
      const handle: VfsProgressHandle = {
        update: () => {},
        complete: () => {},
        fail: () => {},
        cancel: () => {},
      };

      // Lazy-resolve stores so that headless contexts (tests, SSR) degrade gracefully.
      let tasksStore: ReturnType<typeof useBackgroundTasksStore> | null = null;
      let uiStore: ReturnType<typeof useUiStore> | null = null;
      try {
        tasksStore = useBackgroundTasksStore();
        uiStore = useUiStore();
      } catch {
        return handle;
      }
      if (!tasksStore) return handle;

      const translate = (nuxtApp as { $i18n?: { t?: (k: string, p?: unknown) => string } })?.$i18n
        ?.t;
      const title =
        input.operation === 'copy' && input.fileName && typeof translate === 'function'
          ? translate('videoEditor.backgroundTasks.copyTitle', { fileName: input.fileName }) ||
            input.title
          : input.title;

      const taskId = tasksStore.addTask({
        title,
        type: 'file-operation',
        status: 'running',
        progress: 0,
        cancel: input.cancel,
      });

      return {
        update(progress) {
          tasksStore!.updateTaskProgress(taskId, progress);
        },
        complete() {
          tasksStore!.updateTaskStatus(taskId, 'completed');
          uiStore?.notifyFileManagerUpdate?.();
        },
        fail(error) {
          tasksStore!.updateTaskStatus(
            taskId,
            'failed',
            error instanceof Error ? error.message : String(error),
          );
        },
        cancel() {
          tasksStore!.updateTaskStatus(taskId, 'cancelled');
        },
      };
    },
  };
}

export default defineNuxtPlugin(async (nuxtApp) => {
  const translate = (key: string, def?: string) => {
    const i18n = (nuxtApp as { $i18n?: { t: (k: string) => string } }).$i18n;
    if (!i18n) return def ?? key;
    return i18n.t(key) || def || key;
  };

  let adapter: IFileSystemAdapter;

  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const bloggerDogAdapter = new BloggerDogVfsAdapter(() => {
    const bloggerDogStore = useBloggerDogStore();
    return bloggerDogStore.config;
  }, translate);

  const progressReporter = createNuxtVfsProgressReporter(nuxtApp);

  if (isTauri) {
    const handle = workspaceStore.workspaceHandle as unknown as TauriDirectoryHandle | null;
    const workspacePath = handle?.path;

    const projectAdapter = new TauriFileSystemAdapter(async () => {
      const projectHandle = await projectStore.getProjectDirHandle();
      const projectPath = (projectHandle as unknown as TauriDirectoryHandle | null)?.path;
      if (projectPath) return { type: 'absolute', path: projectPath };
      if (workspacePath) return { type: 'absolute', path: workspacePath };
      return { type: 'app-data' };
    });

    const workspaceAdapter = new TauriFileSystemAdapter(
      workspacePath ? { type: 'absolute', path: workspacePath } : TAURI_APP_DATA_BASE_PATH,
    );

    adapter = new RouterFileSystemAdapter(
      projectAdapter,
      [
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
          adapter: bloggerDogAdapter,
          stripPrefix: (p) => (p.startsWith('/remote') ? p.slice('/remote'.length) : p),
        },
      ],
      { progressReporter },
    );
  } else {
    // Browser / OPFS default.
    const projectAdapter = new OpfsFileSystemAdapter(async () => {
      return await projectStore.getProjectDirHandle();
    });

    const workspaceAdapter = new OpfsFileSystemAdapter(async () => {
      return workspaceStore.workspaceHandle ?? null;
    });

    adapter = new RouterFileSystemAdapter(
      projectAdapter,
      [
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
          adapter: bloggerDogAdapter,
          stripPrefix: (p) => (p.startsWith('/remote') ? p.slice('/remote'.length) : p),
        },
      ],
      { progressReporter },
    );
  }

  await adapter.init();

  return {
    provide: {
      vfs: adapter,
    },
  };
});
