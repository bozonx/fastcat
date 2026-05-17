import type { Page } from '@playwright/test';

export interface TauriMockFile {
  path: string;
  data: Uint8Array | string;
}

/**
 * Mocks the global `__TAURI_INTERNALS__` object so the app
 * believes it is running inside a Tauri webview.
 */
export async function mockTauriInternals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      metadata: {
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
      invoke: () => Promise.resolve(),
      listen: () => Promise.resolve(() => {}),
      emit: () => Promise.resolve(),
    };
  });
}

/**
 * Mocks the `@tauri-apps/plugin-fs` module by intercepting
 * the internal invoke calls used by the plugin.
 *
 * Note: This mocks the RPC layer, not the JS module itself.
 * It is sufficient for smoke-testing Tauri-specific code paths.
 */
export async function mockTauriPluginFs(
  page: Page,
  files: TauriMockFile[] = [],
): Promise<void> {
  const serialized = files.map((f) => ({
    path: f.path,
    data: typeof f.data === 'string' ? f.data : Array.from(f.data),
  }));

  await page.addInitScript((mockFiles) => {
    const virtualFs = new Map<string, Uint8Array | string>();

    for (const { path, data } of mockFiles) {
      virtualFs.set(path, typeof data === 'string' ? data : new Uint8Array(data));
    }

    const originalInvoke = (window as any).__TAURI_INTERNALS__?.invoke;

    (window as any).__TAURI_INTERNALS__ = {
      ...((window as any).__TAURI_INTERNALS__ || {}),
      invoke: async (cmd: string, args?: any) => {
        // Basic fs command mocks
        if (cmd.startsWith('plugin:fs|')) {
          const action = cmd.replace('plugin:fs|', '');
          const path = args?.path ?? '';

          switch (action) {
            case 'readFile': {
              const data = virtualFs.get(path);
              if (data === undefined) throw new Error(`File not found: ${path}`);
              return typeof data === 'string' ? new TextEncoder().encode(data) : data;
            }
            case 'writeFile': {
              const contents = args?.data ?? new Uint8Array();
              virtualFs.set(path, new Uint8Array(contents));
              return null;
            }
            case 'exists':
              return virtualFs.has(path);
            case 'mkdir':
              return null;
            case 'remove':
              virtualFs.delete(path);
              return null;
            case 'stat': {
              const data = virtualFs.get(path);
              return {
                size: data ? (typeof data === 'string' ? new TextEncoder().encode(data).length : data.length) : 0,
                mtime: Date.now(),
                isDirectory: false,
                isFile: true,
              };
            }
            default:
              return null;
          }
        }

        if (originalInvoke) {
          return originalInvoke(cmd, args);
        }

        return null;
      },
    };
  }, serialized);
}

/**
 * Mocks Tauri dialog plugin to return a fixed path.
 */
export async function mockTauriDialog(page: Page, result: string | null = '/mock/workspace'): Promise<void> {
  await page.addInitScript((dialogResult) => {
    const originalInvoke = (window as any).__TAURI_INTERNALS__?.invoke;

    (window as any).__TAURI_INTERNALS__ = {
      ...((window as any).__TAURI_INTERNALS__ || {}),
      invoke: async (cmd: string, args?: any) => {
        if (cmd === 'plugin:dialog|open') {
          return dialogResult;
        }

        if (originalInvoke) {
          return originalInvoke(cmd, args);
        }

        return null;
      },
    };
  }, result);
}
