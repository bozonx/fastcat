import type { IFileSystemAdapter, VfsEntry } from './types';

interface DirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

export class OpfsFileSystemAdapter implements IFileSystemAdapter {
  id = 'opfs';
  private rootHandle: FileSystemDirectoryHandle | null = null;

  private async getRoot(): Promise<FileSystemDirectoryHandle | null> {
    if (this.rootHandle) return this.rootHandle;
    this.rootHandle = await this.getProjectRoot();
    return this.rootHandle;
  }

  constructor(private getProjectRoot: () => Promise<FileSystemDirectoryHandle | null>) {}

  async init(): Promise<void> {
    this.rootHandle = await this.getProjectRoot();
  }

  private async getHandleByPath(
    path: string,
    options?: { create?: boolean; isFile?: boolean },
  ): Promise<FileSystemHandle | null> {
    const root = await this.getRoot();
    if (!root) return null;
    if (!path || path === '/') return root;

    const parts = path.split('/').filter(Boolean);
    let currentDir = root;

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
    if (parts.length <= 1) return await this.getRoot();
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
    for await (const [name, entryHandle] of (handle as DirectoryHandleWithIteration).entries?.() ??
      []) {
      entries.push({
        name,
        kind: entryHandle.kind === 'file' ? 'file' : 'directory',
        path: path && path !== '/' ? `${path}/${name}` : name,
        parentPath: path || undefined,
      });
    }
    return entries;
  }

  async createDirectory(path: string): Promise<void> {
    await this.getHandleByPath(path, { create: true, isFile: false });
  }

  async listEntryNames(path: string): Promise<string[]> {
    const entries = await this.readDirectory(path);
    return entries.map((entry) => entry.name);
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

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    const sourceFile = await this.getFile(sourcePath);
    if (!sourceFile) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }

    await this.writeFile(targetPath, sourceFile);
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    await this.createDirectory(targetPath);

    const entries = await this.readDirectory(sourcePath);
    for (const entry of entries) {
      const nextTargetPath = `${targetPath}/${entry.name}`;
      if (entry.kind === 'directory') {
        await this.copyDirectory(entry.path, nextTargetPath);
      } else {
        await this.copyFile(entry.path, nextTargetPath);
      }
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

  async readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    const file = await this.getFile(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file.stream();
  }

  async writeStream(path: string): Promise<WritableStream<Uint8Array>> {
    const parentHandle = await this.getParentDirHandle(path, { create: true });
    if (!parentHandle) throw new Error(`Could not create parent directory for: ${path}`);

    const parts = path.split('/').filter(Boolean);
    const fileName = parts[parts.length - 1];
    if (!fileName) throw new Error(`Invalid file name in path: ${path}`);

    const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });
    const writable = await (fileHandle as any).createWritable();

    // Convert FileSystemWritableFileStream to a standard WritableStream for compatibility
    return new WritableStream({
      write: async (chunk) => {
        await writable.write(chunk);
      },
      close: async () => {
        await writable.close();
      },
      abort: async (err) => {
        await writable.abort(err);
      },
    });
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  }
}
