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
  CONFIG_PATH_PREFIX,
  WORKSPACE_COMMON_PATH_PREFIX,
  WORKSPACE_PROJECT_PATH_PREFIX,
  WORKSPACE_PROJECT_PROXIES_PATH_PREFIX,
  WORKSPACE_PROJECT_TEMP_PATH_PREFIX,
  WORKSPACE_ROOT_PATH_PREFIX,
  toWorkspaceCommonStoragePath,
} from '~/utils/workspace-common';
import { PROJECTS_ROOT_DIR_NAME } from '~/utils/storage-roots';
import { isTauriRuntime } from '~/utils/runtime';
import { joinTauriFsPath } from '~/utils/path';

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
          ? translate('videoEditor.backgroundTasks.copyTitle', { fileName: input.fileName })
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
  /**
   * Adapter rooted at the application config directory. On Tauri this is the OS
   * per-app config dir; in the browser there is no separate config dir, so it
   * aliases the workspace adapter.
   */
  config: IFileSystemAdapter;
  /**
   * Adapter rooted at the resolved, configurable project *temp* root
   * (`ResolvedStorageTopology.tempRoot`) — may live inside the workspace or at
   * an absolute OS cache path (Tauri system default).
   */
  projectTemp: IFileSystemAdapter;
  /**
   * Adapter rooted at the resolved, configurable project *proxies* root
   * (`ResolvedStorageTopology.proxiesRoot`). Only addressed when `proxiesRoot`
   * is configured; otherwise proxies route through `projectTemp`.
   */
  projectProxies: IFileSystemAdapter;
}

/** Matches a POSIX (`/…`) or Windows (`C:\…`) absolute path. */
function isAbsoluteStorageRoot(path: string): boolean {
  return /^\//.test(path) || /^[a-zA-Z]:[\\/]/.test(path);
}

function createTauriWorkspaceAdapters(
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
  projectStore: ReturnType<typeof useProjectStore>,
  fastcatDevDir?: string,
): WorkspaceAdapters {
  // Resolve the workspace path *dynamically* on every call: the workspace is
  // opened after this plugin runs, so capturing the handle once (at init) would
  // pin every adapter to AppData. (The OPFS adapters already read it lazily.)
  const getWorkspacePath = (): string | undefined =>
    (workspaceStore.workspaceHandle as unknown as TauriDirectoryHandle | null)?.path;

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
    const workspacePath = getWorkspacePath();
    if (workspacePath) return { type: 'absolute', path: workspacePath };
    return resolveAppDataDir();
  });

  const workspace = new TauriFileSystemAdapter(async () => {
    const workspacePath = getWorkspacePath();
    if (workspacePath) return { type: 'absolute', path: workspacePath };

    // Fall back to content root (parent of commonRoot) in workspace-less mode
    const commonRoot = workspaceStore.resolvedStorageTopology.commonRoot;
    if (commonRoot) {
      const { resolve } = await import('@tauri-apps/api/path');
      try {
        const resolvedCommon = await resolve(commonRoot);
        return { type: 'absolute', path: resolvedCommon.replace(/[\\/]common$/, '') };
      } catch {
        // ignore and fall back
      }
    }
    return resolveAppDataDir();
  });

  const vardata = new TauriFileSystemAdapter(async () => {
    const { resolveTauriAppPaths } = await import('~/utils/tauri-paths');
    const paths = await resolveTauriAppPaths(fastcatDevDir);
    if (paths) {
      return { type: 'absolute', path: joinTauriFsPath(paths.cacheDir, 'vardata') };
    }
    const { appDataDir } = await import('@tauri-apps/api/path');
    return { type: 'absolute', path: joinTauriFsPath(await appDataDir(), 'vardata') };
  });

  const config = new TauriFileSystemAdapter(async () => {
    const { resolveTauriAppPaths } = await import('~/utils/tauri-paths');
    const paths = await resolveTauriAppPaths(fastcatDevDir);
    if (paths) return { type: 'absolute', path: paths.configDir };
    const { appConfigDir } = await import('@tauri-apps/api/path');
    return { type: 'absolute', path: await appConfigDir() };
  });

  // A configurable storage root (temp/proxies) is either an absolute OS path
  // (Tauri system default) — used as-is — or a workspace-relative segment chain
  // (Tauri portable) — joined onto the workspace path.
  const resolveConfigurableRoot = async (
    rootPath: string,
  ): Promise<{ type: 'absolute'; path: string }> => {
    const trimmed = (rootPath ?? '').trim();
    if (trimmed && isAbsoluteStorageRoot(trimmed)) {
      return { type: 'absolute', path: trimmed };
    }
    const workspacePath = getWorkspacePath();
    if (workspacePath) {
      if (!trimmed) return { type: 'absolute', path: workspacePath };
      return { type: 'absolute', path: joinTauriFsPath(workspacePath, trimmed) };
    }
    return resolveAppDataDir();
  };

  const projectTemp = new TauriFileSystemAdapter(() =>
    resolveConfigurableRoot(workspaceStore.resolvedStorageTopology.tempRoot),
  );
  const projectProxies = new TauriFileSystemAdapter(() =>
    resolveConfigurableRoot(workspaceStore.resolvedStorageTopology.proxiesRoot),
  );

  return { project, workspace, vardata, config, projectTemp, projectProxies };
}

function createOpfsWorkspaceAdapters(
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
  projectStore: ReturnType<typeof useProjectStore>,
): WorkspaceAdapters {
  const project = new OpfsFileSystemAdapter(() => projectStore.getProjectDirHandle());
  const workspace = new OpfsFileSystemAdapter(async () => workspaceStore.workspaceHandle ?? null);

  // In the browser the configurable roots are always workspace-relative segment
  // chains (no absolute OS paths) — navigate into the workspace handle, creating
  // intermediate directories so the root exists on first write.
  const navigateWorkspaceSubdir = async (
    rootPath: string,
  ): Promise<FileSystemDirectoryHandle | null> => {
    const ws = workspaceStore.workspaceHandle ?? null;
    if (!ws) return null;
    const segments = (rootPath ?? '')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    let dir = ws;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
    return dir;
  };

  const projectTemp = new OpfsFileSystemAdapter(() =>
    navigateWorkspaceSubdir(workspaceStore.resolvedStorageTopology.tempRoot),
  );
  const projectProxies = new OpfsFileSystemAdapter(() =>
    navigateWorkspaceSubdir(workspaceStore.resolvedStorageTopology.proxiesRoot),
  );

  // The browser has no separate config dir — config settings live in the workspace.
  return { project, workspace, vardata: workspace, config: workspace, projectTemp, projectProxies };
}

/**
 * Declarative route table. Each entry maps a path prefix to an adapter,
 * letting us add new adapters without branching on platform.
 */
function buildVfsRoutes(args: {
  workspace: IFileSystemAdapter;
  vardata: IFileSystemAdapter;
  config: IFileSystemAdapter;
  projectTemp: IFileSystemAdapter;
  projectProxies: IFileSystemAdapter;
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
      // `@workspace/<rest>` → workspace root `<rest>` (parent of projects/common).
      prefix: WORKSPACE_ROOT_PATH_PREFIX,
      adapter: args.workspace,
      stripPrefix: stripPrefix(WORKSPACE_ROOT_PATH_PREFIX),
    },
    {
      // `@config/<rest>` → application config dir `<rest>`.
      prefix: CONFIG_PATH_PREFIX,
      adapter: args.config,
      stripPrefix: stripPrefix(CONFIG_PATH_PREFIX),
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
      // `@ptemp/<rest>` → resolved temp root `<rest>`.
      prefix: WORKSPACE_PROJECT_TEMP_PATH_PREFIX,
      adapter: args.projectTemp,
      stripPrefix: stripPrefix(WORKSPACE_PROJECT_TEMP_PATH_PREFIX),
    },
    {
      // `@pproxies/<rest>` → resolved proxies root `<rest>`.
      prefix: WORKSPACE_PROJECT_PROXIES_PATH_PREFIX,
      adapter: args.projectProxies,
      stripPrefix: stripPrefix(WORKSPACE_PROJECT_PROXIES_PATH_PREFIX),
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
  const translate = (key: string) => {
    const i18n = (nuxtApp as { $i18n?: { t: (k: string) => string } }).$i18n;
    if (!i18n) return key;
    return i18n.t(key);
  };

  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const isTauri = isTauriRuntime();
  const runtimeConfig = useRuntimeConfig();

  const { project, workspace, vardata, config, projectTemp, projectProxies } = isTauri
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
    buildVfsRoutes({ workspace, vardata, config, projectTemp, projectProxies, remote }),
    {
      progressReporter: createNuxtVfsProgressReporter(nuxtApp),
    },
  );

  void adapter.init();

  return {
    provide: {
      vfs: adapter,
    },
  };
});
