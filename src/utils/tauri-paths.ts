import { isTauriRuntime } from './runtime';

const isDevMode = (): boolean => import.meta.dev;

export interface TauriAppPaths {
  configDir: string;
  dataDir: string;
  cacheDir: string;
  tempDir: string;
  documentsDir: string;
}

export async function resolveTauriAppPaths(
  fastcatDevDir?: string,
  forceDev?: boolean,
): Promise<TauriAppPaths | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { appConfigDir, appDataDir, appCacheDir, documentDir, tempDir, join, resolve } =
    await import('@tauri-apps/api/path');

  if ((isDevMode() || forceDev) && fastcatDevDir) {
    const devRoot = await resolve(fastcatDevDir);
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('allow_dev_directory_scope', { path: devRoot }).catch(() => undefined);

    return {
      configDir: await join(devRoot, 'config'),
      dataDir: await join(devRoot, 'data'),
      cacheDir: await join(devRoot, 'cache'),
      tempDir: await join(devRoot, 'tmp'),
      documentsDir: await join(devRoot, 'Documents'),
    };
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
