import { mkdir, readDir, readFile, writeFile, remove, stat, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

export class TauriFileHandle {
  kind = 'file' as const;
  name: string;
  path: string;

  constructor(path: string, name: string) {
    this.path = path;
    this.name = name;
  }

  async getFile(): Promise<File> {
    const bytes = await readFile(this.path);
    const blob = new Blob([bytes]);
    const fileStat = await stat(this.path).catch(() => ({ mtime: Date.now() }));
    return new File([blob], this.name, {
      lastModified: fileStat.mtime ? new Date(fileStat.mtime).getTime() : Date.now(),
    });
  }

  async createWritable(): Promise<{
    write: (data: any) => Promise<void>;
    close: () => Promise<void>;
  }> {
    return {
      write: async (data: any) => {
        let bytes: Uint8Array;
        if (typeof data === 'string') {
          bytes = new TextEncoder().encode(data);
        } else if (data instanceof Uint8Array) {
          bytes = data;
        } else {
          bytes = new Uint8Array(await new Blob([data]).arrayBuffer());
        }
        await writeFile(this.path, bytes);
      },
      close: async () => {},
    };
  }
}

export class TauriDirectoryHandle {
  kind = 'directory' as const;
  name: string;
  path: string;

  constructor(path: string, name: string) {
    this.path = path;
    this.name = name;
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<TauriDirectoryHandle> {
    const childPath = await join(this.path, name);
    const dirExists = await exists(childPath);

    if (!dirExists) {
      if (options?.create) {
        await mkdir(childPath, { recursive: true });
      } else {
        throw new DOMException(`Directory ${name} not found`, 'NotFoundError');
      }
    } else {
      const dirStat = await stat(childPath);
      if (!dirStat.isDirectory) {
        throw new DOMException(`${name} is not a directory`, 'TypeMismatchError');
      }
    }

    return new TauriDirectoryHandle(childPath, name);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<TauriFileHandle> {
    const childPath = await join(this.path, name);
    const fileExists = await exists(childPath);

    if (!fileExists) {
      if (options?.create) {
        await writeFile(childPath, new Uint8Array());
      } else {
        throw new DOMException(`File ${name} not found`, 'NotFoundError');
      }
    } else {
      const fileStat = await stat(childPath);
      if (fileStat.isDirectory) {
        throw new DOMException(`${name} is a directory`, 'TypeMismatchError');
      }
    }

    return new TauriFileHandle(childPath, name);
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const childPath = await join(this.path, name);
    await remove(childPath, { recursive: options?.recursive });
  }

  async *values(): AsyncIterable<TauriDirectoryHandle | TauriFileHandle> {
    const entries = await readDir(this.path);
    for (const entry of entries) {
      const childPath = await join(this.path, entry.name);
      if (entry.isDirectory) {
        yield new TauriDirectoryHandle(childPath, entry.name);
      } else {
        yield new TauriFileHandle(childPath, entry.name);
      }
    }
  }

  async *entries(): AsyncIterable<[string, TauriDirectoryHandle | TauriFileHandle]> {
    for await (const value of this.values()) {
      yield [value.name, value];
    }
  }
}
