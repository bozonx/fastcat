import type { IFileSystemAdapter, VfsEntry } from './types';

export class OpfsFileSystemAdapter implements IFileSystemAdapter {
  id = 'opfs';
  private rootHandle: FileSystemDirectoryHandle | null = null;
  // A mapping from path to FileSystemHandle to avoid repeatedly traversing the tree if possible.
  // Although in OPFS it's safer to traverse or just use it when needed.
  // For simplicity, we might just traverse from the root or expect the caller to provide it.
  // Wait, IFileSystemAdapter uses pure string paths. We need to parse them and get handles.

  constructor(private getWorkspaceRoot: () => Promise<FileSystemDirectoryHandle | null>) {}

  async init(): Promise<void> {
    this.rootHandle = await this.getWorkspaceRoot();
  }

  private async getHandleByPath(
    path: string,
    options?: { create?: boolean; isFile?: boolean },
  ): Promise<FileSystemHandle | null> {
    if (!this.rootHandle) return null;
    if (!path || path === '/') return this.rootHandle;

    const parts = path.split('/').filter(Boolean);
    let currentDir = this.rootHandle;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const isLast = i === parts.length - 1;

      try {
        if (isLast) {
          if (options?.isFile) {
            return await currentDir.getFileHandle(part, { create: options?.create });
          } else {
            return await currentDir.getDirectoryHandle(part, { create: options?.create });
          }
        } else {
          currentDir = await currentDir.getDirectoryHandle(part, { create: options?.create });
        }
      } catch (e: unknown) {
        if ((e as Error).name === 'NotFoundError' || (e as Error).name === 'TypeMismatchError') {
          return null;
        }
        throw e;
      }
    }
    return null;
  }

  private async getParentDirHandle(
    path: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle | null> {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 1) return this.rootHandle;
    const parentPath = parts.slice(0, -1).join('/');
    return (await this.getHandleByPath(parentPath, {
      create: options?.create,
      isFile: false,
    })) as FileSystemDirectoryHandle | null;
  }

  async readDirectory(path: string): Promise<VfsEntry[]> {
    const handle = (await this.getHandleByPath(path, {
      isFile: false,
    })) as FileSystemDirectoryHandle | null;
    if (!handle) return [];

    const entries: VfsEntry[] = [];
    for await (const [name, entryHandle] of (handle as any).entries()) {
      entries.push({
        name,
        kind: entryHandle.kind === 'file' ? 'file' : 'directory',
        path: path && path !== '/' ? `${path}/${name}` : name,
      });
    }
    return entries;
  }

  async createDirectory(path: string): Promise<void> {
    await this.getHandleByPath(path, { create: true, isFile: false });
  }

  async readFile(path: string): Promise<Blob> {
    const handle = (await this.getHandleByPath(path, {
      isFile: true,
    })) as FileSystemFileHandle | null;
    if (!handle) throw new Error(`File not found: ${path}`);
    return await handle.getFile();
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    const parentHandle = await this.getParentDirHandle(path, { create: true });
    if (!parentHandle) throw new Error(`Could not create parent directory for: ${path}`);

    const parts = path.split('/').filter(Boolean);
    const fileName = parts[parts.length - 1];
    if (!fileName) throw new Error(`Invalid file name in path: ${path}`);

    const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(data);
    await writable.close();
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const parentHandle = await this.getParentDirHandle(path);
    if (!parentHandle) return; // parent doesn't exist, nothing to delete

    const parts = path.split('/').filter(Boolean);
    const name = parts[parts.length - 1];
    if (!name) return; // root or empty path

    try {
      await (parentHandle as any).removeEntry(name, { recursive });
    } catch (e: unknown) {
      if ((e as Error).name !== 'NotFoundError') throw e;
    }
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    const sourceHandle = await this.getHandleByPath(sourcePath);
    if (!sourceHandle) throw new Error(`Source not found: ${sourcePath}`);

    const targetParentHandle = await this.getParentDirHandle(targetPath, { create: true });
    if (!targetParentHandle) throw new Error(`Target parent not found: ${targetPath}`);

    const targetParts = targetPath.split('/').filter(Boolean);
    const targetName = targetParts[targetParts.length - 1];
    if (!targetName) throw new Error(`Invalid target path: ${targetPath}`);

    if ((sourceHandle as any).move) {
      await (sourceHandle as any).move(targetParentHandle, targetName);
    } else {
      throw new Error("Moving is not supported by this browser's OPFS implementation");
    }
  }

  async exists(path: string): Promise<boolean> {
    const handle = await this.getHandleByPath(path);
    return !!handle;
  }

  async getMetadata(
    path: string,
  ): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null> {
    const handle = await this.getHandleByPath(path);
    if (!handle) return null;

    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      return {
        size: file.size,
        lastModified: file.lastModified,
        kind: 'file',
      };
    } else {
      return {
        size: 0,
        lastModified: Date.now(),
        kind: 'directory',
      };
    }
  }

  async getObjectUrl(path: string): Promise<string> {
    const blob = await this.readFile(path);
    return URL.createObjectURL(blob);
  }

  async getFile(path: string): Promise<File | null> {
    const handle = (await this.getHandleByPath(path, {
      isFile: true,
    })) as FileSystemFileHandle | null;
    if (!handle) return null;
    return await handle.getFile();
  }
}
