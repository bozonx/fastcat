import type { Page } from '@playwright/test';

export interface OpfsWriteFileOptions {
  path: string;
  data: Uint8Array | string;
}

export interface SetupVirtualWorkspaceOptions {
  workspaceName?: string;
}

/**
 * Clears the entire Origin Private File System.
 */
export async function clearOpfs(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();

    for await (const [name] of (root as any).entries?.() ?? []) {
      await (root as any).removeEntry(name, { recursive: true });
    }
  });
}

/**
 * Writes a file into OPFS under the given path.
 * Creates parent directories automatically.
 */
export async function writeFileToOpfs(page: Page, options: OpfsWriteFileOptions): Promise<void> {
  const { path, data } = options;

  await page.evaluate(
    async ({ filePath, fileData }) => {
      const root = await navigator.storage.getDirectory();
      const parts = filePath.split('/').filter(Boolean);
      let dir = root;

      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }

      const fileName = parts[parts.length - 1];
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await (fileHandle as any).createWritable();
      const blob =
        typeof fileData === 'string'
          ? new Blob([fileData])
          : new Blob([new Uint8Array(fileData)]);

      await writable.write(blob);
      await writable.close();
    },
    { filePath: path, fileData: typeof data === 'string' ? data : Array.from(data) },
  );
}

/**
 * Creates a directory tree in OPFS.
 */
export async function createDirectoryInOpfs(page: Page, path: string): Promise<void> {
  await page.evaluate(async (dirPath) => {
    const root = await navigator.storage.getDirectory();
    const parts = dirPath.split('/').filter(Boolean);
    let dir = root;

    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
  }, path);
}

/**
 * Reads a file from OPFS as Uint8Array.
 */
export async function readFileFromOpfs(page: Page, path: string): Promise<Uint8Array> {
  const array = await page.evaluate(async (filePath) => {
    const root = await navigator.storage.getDirectory();
    const parts = filePath.split('/').filter(Boolean);
    let dir = root;

    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }

    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }, path);

  return new Uint8Array(array);
}

/**
 * Sets up a standard workspace structure in OPFS for e2e tests.
 */
export async function setupVirtualWorkspace(
  page: Page,
  options: SetupVirtualWorkspaceOptions = {},
): Promise<void> {
  const { workspaceName = 'e2e-workspace' } = options;

  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const workspace = await root.getDirectoryHandle(name, { create: true });

    await workspace.getDirectoryHandle('projects', { create: true });
    await workspace.getDirectoryHandle('common', { create: true });
    await workspace.getDirectoryHandle('vardata', { create: true });
  }, workspaceName);
}
