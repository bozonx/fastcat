import { browser } from '@wdio/globals';

/**
 * Invokes a Tauri IPC command inside the WebKitGTK webview context.
 */
export async function invokeTauri<T = unknown>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return await browser.execute(
    async (commandName, payload) => {
      if (
        '__TAURI_INTERNALS__' in window &&
        typeof (window as any).__TAURI_INTERNALS__?.invoke === 'function'
      ) {
        return await (window as any).__TAURI_INTERNALS__.invoke(commandName, payload);
      }
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke(commandName, payload);
    },
    cmd,
    args,
  );
}
