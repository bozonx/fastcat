import { isTauriRuntime } from './runtime';

const isDevMode = (): boolean => import.meta.dev;

export interface TauriAppPaths {
  configDir: string;
  dataDir: string;
  cacheDir: string;
  tempDir: string;
  documentsDir: string;
}

/**
 * Builds an emulated OS directory tree inside the dev root so that
 * development paths mirror real OS layout.
 *
 * Examples:
 * - Linux:   <devRoot>/home/user/config/fastcat
 * - macOS:   <devRoot>/Users/user/Library/Application Support/fastcat
 * - Windows: <devRoot>/Users/user/AppData/Roaming/fastcat
 */
async function buildDevOsPaths(devRoot: string): Promise<TauriAppPaths> {
  const { join } = await import('@tauri-apps/api/path');
  const { platform } = await import('@tauri-apps/plugin-os');

  const user = 'user';
  const app = 'fastcat';
  const os = platform();

  switch (os) {
    case 'windows': {
      const home = await join(devRoot, 'Users', user);
      return {
        configDir: await join(home, 'AppData', 'Roaming', app),
        dataDir: await join(home, 'AppData', 'Roaming', app),
        cacheDir: await join(home, 'AppData', 'Local', app),
        tempDir: await join(home, 'AppData', 'Local', 'Temp', app),
        documentsDir: await join(home, 'Documents'),
      };
    }
    case 'macos': {
      const home = await join(devRoot, 'Users', user);
      return {
        configDir: await join(home, 'Library', 'Application Support', app),
        dataDir: await join(home, 'Library', 'Application Support', app),
        cacheDir: await join(home, 'Library', 'Caches', app),
        tempDir: await join(devRoot, 'tmp', app),
        documentsDir: await join(home, 'Documents'),
      };
    }
    case 'linux':
    default: {
      const home = await join(devRoot, 'home', user);
      return {
        configDir: await join(home, 'config', app),
        dataDir: await join(home, 'local', 'share', app),
        cacheDir: await join(home, 'cache', app),
        tempDir: await join(devRoot, 'tmp', app),
        documentsDir: await join(home, 'Documents'),
      };
    }
  }
}

/**
 * Memoizes the resolved app paths per (devDir, forceDev) key.
 *
 * Without this, every VFS operation routed through the config/vardata/temp/
 * proxies adapters re-runs the full resolver — which in dev means an
 * `allow_dev_directory_scope` IPC plus five sequential `mkdir` round-trips, and
 * in production five Tauri path-API IPCs — on *every* read/write. Caching the
 * Promise collapses all that to a single resolution (and a single dev-mode
 * directory-ensure) for the lifetime of the process.
 */
const appPathsCache = new Map<string, Promise<TauriAppPaths | null>>();

export async function resolveTauriAppPaths(
  fastcatDevDir?: string,
  forceDev?: boolean,
): Promise<TauriAppPaths | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const cacheKey = `${fastcatDevDir ?? ''}|${forceDev ? 1 : 0}`;
  const cached = appPathsCache.get(cacheKey);
  if (cached) return cached;

  const pending = resolveTauriAppPathsUncached(fastcatDevDir, forceDev).catch((e) => {
    // Don't poison the cache on failure — a later call may succeed.
    appPathsCache.delete(cacheKey);
    throw e;
  });
  appPathsCache.set(cacheKey, pending);
  return pending;
}

/** Test-only: drop the memoized paths so a spec can re-exercise resolution. */
export function __resetTauriAppPathsCacheForTesting(): void {
  appPathsCache.clear();
}

async function resolveTauriAppPathsUncached(
  fastcatDevDir?: string,
  forceDev?: boolean,
): Promise<TauriAppPaths | null> {
  const { appConfigDir, appDataDir, appCacheDir, documentDir, tempDir, resolve } =
    await import('@tauri-apps/api/path');

  if ((isDevMode() || forceDev) && fastcatDevDir) {
    const devRoot = await resolve(fastcatDevDir);
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('allow_dev_directory_scope', { path: devRoot });
    } catch {
      // ignore scope extension failure in dev
    }

    const paths = await buildDevOsPaths(devRoot);
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    for (const [, dir] of Object.entries(paths)) {
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        // ignore mkdir failure in dev (directory may already exist)
      }
    }

    return paths;
  }

  // Production: standard OS directories via Tauri path API
  return {
    configDir: await appConfigDir(),
    dataDir: await appDataDir(),
    cacheDir: await appCacheDir(),
    tempDir: await tempDir(),
    documentsDir: await documentDir(),
  };
}
