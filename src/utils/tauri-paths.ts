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

export async function resolveTauriAppPaths(
  fastcatDevDir?: string,
  forceDev?: boolean,
): Promise<TauriAppPaths | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { appConfigDir, appDataDir, appCacheDir, documentDir, tempDir, resolve } =
    await import('@tauri-apps/api/path');

  if ((isDevMode() || forceDev) && fastcatDevDir) {
    const devRoot = await resolve(fastcatDevDir);
    console.log('[tauri-paths] devRoot resolved:', devRoot);
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('allow_dev_directory_scope', { path: devRoot });
      console.log('[tauri-paths] scope extended for:', devRoot);
    } catch (e) {
      console.error('[tauri-paths] allow_dev_directory_scope failed:', e);
    }

    const paths = await buildDevOsPaths(devRoot);
    console.log('[tauri-paths] dev paths:', paths);
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    for (const [key, dir] of Object.entries(paths)) {
      try {
        await mkdir(dir, { recursive: true });
        console.log('[tauri-paths] mkdir ok:', key, dir);
      } catch (e) {
        console.error('[tauri-paths] mkdir failed:', key, dir, e);
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
