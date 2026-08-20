import { browser } from '@wdio/globals';

interface IpcResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Invokes a Tauri IPC command inside the WebKitGTK webview context.
 * Wraps the execution in a page-side try/catch to ensure IPC errors are cleanly
 * serialized back to the Node test process without WebDriver protocol parse errors.
 */
export async function invokeTauri<T = unknown>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await browser.execute(
    async (commandName, payload): Promise<IpcResponse<unknown>> => {
      try {
        let data: unknown;
        if (
          '__TAURI_INTERNALS__' in window &&
          typeof (window as any).__TAURI_INTERNALS__?.invoke === 'function'
        ) {
          data = await (window as any).__TAURI_INTERNALS__.invoke(commandName, payload);
        } else {
          const { invoke } = await import('@tauri-apps/api/core');
          data = await invoke(commandName, payload);
        }
        return { ok: true, data };
      } catch (err: unknown) {
        return { ok: false, error: String(err) };
      }
    },
    cmd,
    args,
  );

  if (!response.ok) {
    throw new Error(response.error ?? 'IPC command failed');
  }

  return response.data as T;
}
