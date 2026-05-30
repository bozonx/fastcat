import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';
import { RouterFileSystemAdapter, type VfsRoute } from '~/file-manager/core/vfs/router.adapter';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { TauriFileSystemAdapter } from '~/file-manager/core/vfs/tauri.adapter';
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
  WORKSPACE_PROJECT_PATH_PREFIX,
  toWorkspaceCommonStoragePath,
} from '~/utils/workspace-common';
import { PROJECTS_ROOT_DIR_NAME } from '~/utils/storage-roots';
import { isTauriRuntime } from '~/utils/runtime';

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

/**
 * Builds the workspace adapter set for the current platform.
 *
 * To add another platform-specific adapter, plug in a new branch here — the
 * downstream route table is platform-agnostic.
 */
interface WorkspaceAdapters {
  /** Adapter rooted at the active project directory. */
  project: IFileSystemAdapter;
  /** Adapter rooted at the workspace directory (parent of all projects + common assets). */
  workspace: IFileSystemAdapter;
  /** Adapter rooted at the system cache/vardata directory. */
  vardata: IFileSystemAdapter;
}

function createTauriWorkspaceAdapters(
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
  projectStore: ReturnType<typeof useProjectStore>,
  fastcatDevDir?: string,
): WorkspaceAdapters {
  const handle = workspaceStore.workspaceHandle as unknown as TauriDirectoryHandle | null;
  const workspacePath = handle?.path;

  async function resolveAppDataDir(): Promise<{ type: 'absolute'; path: string }> {
    const { resolveTauriAppPaths } = await import('~/utils/tauri-paths');
    const paths = await resolveTauriAppPaths(fastcatDevDir);
    if (paths) {
      return { type: 'absolute', path: paths.dataDir };
    }
    const { appDataDir } = await import('@tauri-apps/api/path');
    return { type: 'absolute', path: await appDataDir() };
  }

  const project = new TauriFileSystemAdapter(async () => {
    const projectHandle = await projectStore.getProjectDirHandle();
    const projectPath = (projectHandle as unknown as TauriDirectoryHandle | null)?.path;
    if (projectPath) return { type: 'absolute', path: projectPath };
    if (workspacePath) return { type: 'absolute', path: workspacePath };
    return resolveAppDataDir();
  });

  const workspace = new TauriFileSystemAdapter(async () => {
    if (workspacePath) return { type: 'absolute', path: workspacePath };
    return resolveAppDataDir();
  });

  const vardata = new TauriFileSystemAdapter(async () => {
    const { resolveTauriAppPaths } = await import('~/utils/tauri-paths');
    const paths = await resolveTauriAppPaths(fastcatDevDir);
    if (paths) {
      const { join } = await import('@tauri-apps/api/path');
      const vardataPath = await join(paths.cacheDir, 'vardata');
      return { type: 'absolute', path: vardataPath };
    }
    const { appDataDir } = await import('@tauri-apps/api/path');
    const { join } = await import('@tauri-apps/api/path');
    return { type: 'absolute', path: await join(await appDataDir(), 'vardata') };
  });

  return { project, workspace, vardata };
}

function createOpfsWorkspaceAdapters(
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
  projectStore: ReturnType<typeof useProjectStore>,
): WorkspaceAdapters {
  const project = new OpfsFileSystemAdapter(() => projectStore.getProjectDirHandle());
  const workspace = new OpfsFileSystemAdapter(async () => workspaceStore.workspaceHandle ?? null);
  return { project, workspace, vardata: workspace };
}

/**
 * Declarative route table. Each entry maps a path prefix to an adapter,
 * letting us add new adapters without branching on platform.
 */
function buildVfsRoutes(args: {
  workspace: IFileSystemAdapter;
  vardata: IFileSystemAdapter;
  remote: IFileSystemAdapter;
}): VfsRoute[] {
  const stripPrefix = (prefix: string) => (path: string) =>
    path.startsWith(prefix) ? path.slice(prefix.length).replace(/^\/+/, '') : path;

  return [
    {
      prefix: WORKSPACE_COMMON_PATH_PREFIX,
      adapter: args.workspace,
      stripPrefix: toWorkspaceCommonStoragePath,
    },
    {
      // `@project/<name>/<rest>` → workspace-relative `projects/<name>/<rest>`.
      // Addresses a specific project regardless of which one is active.
      prefix: WORKSPACE_PROJECT_PATH_PREFIX,
      adapter: args.workspace,
      stripPrefix: (path: string) => {
        const rel =
          path === WORKSPACE_PROJECT_PATH_PREFIX
            ? ''
            : path.slice(`${WORKSPACE_PROJECT_PATH_PREFIX}/`.length);
        return rel ? `${PROJECTS_ROOT_DIR_NAME}/${rel}` : PROJECTS_ROOT_DIR_NAME;
      },
    },
    {
      prefix: '/vardata',
      adapter: args.vardata,
      stripPrefix: (p) => (p.startsWith('/') ? p.slice(1) : p),
    },
    {
      prefix: '/remote',
      adapter: args.remote,
      stripPrefix: stripPrefix('/remote'),
    },
  ];
}

export default defineNuxtPlugin(async (nuxtApp) => {
  const translate = (key: string, def?: string) => {
    const i18n = (nuxtApp as { $i18n?: { t: (k: string) => string } }).$i18n;
    if (!i18n) return def ?? key;
    return i18n.t(key) || def || key;
  };

  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const isTauri = isTauriRuntime();
  const runtimeConfig = useRuntimeConfig();

  const { project, workspace, vardata } = isTauri
    ? createTauriWorkspaceAdapters(
        workspaceStore,
        projectStore,
        runtimeConfig.public.fastcatDevDir as string | undefined,
      )
    : createOpfsWorkspaceAdapters(workspaceStore, projectStore);

  const remote = new BloggerDogVfsAdapter(() => {
    const bloggerDogStore = useBloggerDogStore();
    return bloggerDogStore.config;
  }, translate);

  const adapter = new RouterFileSystemAdapter(
    project,
    buildVfsRoutes({ workspace, vardata, remote }),
    {
      progressReporter: createNuxtVfsProgressReporter(nuxtApp),
    },
  );

  await adapter.init();

  return {
    provide: {
      vfs: adapter,
    },
  };
});
