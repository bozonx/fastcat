import type { Page } from '@playwright/test';

export interface OpfsWriteFileOptions {
  path: string;
  data: Uint8Array | string;
}

export interface SetupVirtualWorkspaceOptions {
  workspaceName?: string;
}

export interface OpfsEntryInfo {
  name: string;
  kind: FileSystemHandleKind;
}

/**
 * Removes a single root entry from OPFS.
 */
export async function removeOpfsEntry(page: Page, name: string): Promise<void> {
  await page.evaluate(async (entryName) => {
    const root = await navigator.storage.getDirectory();

    try {
      await (root as any).removeEntry(entryName, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') {
        throw error;
      }
    }
  }, name);
}

/**
 * Checks whether an OPFS entry exists.
 */
export async function opfsEntryExists(page: Page, path: string): Promise<boolean> {
  return await page.evaluate(async (entryPath) => {
    const root = await navigator.storage.getDirectory();
    const parts = entryPath.split('/').filter(Boolean);
    if (parts.length === 0) return true;

    let dir = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;

      try {
        if (isLast) {
          try {
            await dir.getDirectoryHandle(name);
            return true;
          } catch (error) {
            if (!(error instanceof DOMException) || error.name !== 'TypeMismatchError') {
              throw error;
            }
          }

          await dir.getFileHandle(name);
          return true;
        }

        dir = await dir.getDirectoryHandle(name);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          return false;
        }
        throw error;
      }
    }

    return false;
  }, path);
}

/**
 * Lists a directory in OPFS.
 */
export async function listOpfsDirectory(page: Page, path: string): Promise<OpfsEntryInfo[]> {
  return await page.evaluate(async (dirPath) => {
    const root = await navigator.storage.getDirectory();
    const parts = dirPath.split('/').filter(Boolean);
    let dir = root;

    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }

    const entries: Array<{ name: string; kind: FileSystemHandleKind }> = [];
    for await (const [name, handle] of dir.entries()) {
      entries.push({ name, kind: handle.kind });
    }

    return entries;
  }, path);
}

/**
 * Clears the entire Origin Private File System.
 * Prefer `removeOpfsEntry` for parallel tests.
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
        typeof fileData === 'string' ? new Blob([fileData]) : new Blob([new Uint8Array(fileData)]);

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
 * Reads a UTF-8 text file from OPFS.
 */
export async function readTextFileFromOpfs(page: Page, path: string): Promise<string> {
  const bytes = await readFileFromOpfs(page, path);
  return new TextDecoder().decode(bytes);
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
