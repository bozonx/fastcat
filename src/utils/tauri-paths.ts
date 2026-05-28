import { isTauriRuntime } from './runtime';

const isDevMode = (): boolean => import.meta.dev;

export interface TauriAppPaths {
  configDir: string;
  cacheDir: string;
  documentsDir: string;
}

export async function resolveTauriAppPaths(
  fastcatDevDir?: string,
  forceDev?: boolean,
): Promise<TauriAppPaths | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const { appConfigDir, appCacheDir, documentDir, resolve, join } =
    await import('@tauri-apps/api/path');

  if ((isDevMode() || forceDev) && fastcatDevDir) {
    const devRoot = await resolve(fastcatDevDir);
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMac = userAgent.includes('Macintosh') || userAgent.includes('Mac OS X');
    const isWindows = userAgent.includes('Windows') || userAgent.includes('Win32');

    let configDir: string;
    let cacheDir: string;
    let documentsDir: string;

    if (isMac) {
      configDir = await join(devRoot, 'Library', 'Application Support', 'com.bozonx.fastcat');
      cacheDir = await join(devRoot, 'Library', 'Caches', 'com.bozonx.fastcat');
      documentsDir = await join(devRoot, 'Documents');
    } else if (isWindows) {
      configDir = await join(devRoot, 'AppData', 'Roaming', 'com.bozonx.fastcat');
      cacheDir = await join(devRoot, 'AppData', 'Local', 'com.bozonx.fastcat');
      documentsDir = await join(devRoot, 'Documents');
    } else {
      // Linux / Default
      configDir = await join(devRoot, '.config', 'com.bozonx.fastcat');
      cacheDir = await join(devRoot, '.cache', 'com.bozonx.fastcat');
      documentsDir = await join(devRoot, 'Documents');
    }

    return {
      configDir,
      cacheDir,
      documentsDir,
    };
  }

  // Production: standard OS directories via Tauri path API
  return {
    configDir: await appConfigDir(),
    cacheDir: await appCacheDir(),
    documentsDir: await documentDir(),
  };
}
