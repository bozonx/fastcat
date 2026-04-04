import type { IFileSystemAdapter, VfsEntry } from './types';

import { appDataDir, join } from '@tauri-apps/api/path';
import {
  BaseDirectory,
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  stat,
  writeFile,
} from '@tauri-apps/plugin-fs';
import { openReadFileStream, openWriteFileStream } from 'tauri-plugin-fs-stream-api';

import { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';

export class TauriFileSystemAdapter implements IFileSystemAdapter {
  id = 'tauri';
  private basePath: string | (() => string | Promise<string>);

  constructor(basePath: string | (() => string | Promise<string>)) {
    this.basePath = basePath;
  }

  private async getBasePath(): Promise<string> {
    if (typeof this.basePath === 'function') {
      return await this.basePath();
    }
    return this.basePath;
  }

  async init(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      throw new Error('Not running in Tauri environment');
    }

    const { tauriPath, options } = await this.getTauriFsArgs('');
    await mkdir(tauriPath, {
      ...options,
      recursive: true,
    }).catch(() => undefined);
  }

  private async getTauriFsArgs(
    path: string,
  ): Promise<{ tauriPath: string; options: { baseDir?: BaseDirectory } }> {
    const normalizedPath = this.normalizePath(path);
    const basePath = await this.getBasePath();

    if (basePath === 'app-data') {
      return {
        tauriPath: normalizedPath,
        options: { baseDir: BaseDirectory.AppData },
      };
    }

    // Treat as absolute path
    const tauriPath = normalizedPath ? await join(basePath, normalizedPath) : basePath;
    return {
      tauriPath,
      options: { baseDir: undefined },
    };
  }

  private normalizePath(path: string): string {
    return path.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private getEntryName(path: string): string {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  }

  private getParentPath(path: string): string {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length <= 1) {
      return '';
    }

    return parts.slice(0, -1).join('/');
  }

  private async resolveStreamPath(path: string): Promise<string> {
    const normalizedPath = this.normalizePath(path);
    const basePath = await this.getBasePath();
    const baseDirPath = basePath.startsWith('/') ? basePath : await appDataDir();
    return normalizedPath ? await join(baseDirPath, normalizedPath) : baseDirPath;
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const parentPath = this.getParentPath(path);
    if (!parentPath) {
      return;
    }

    const { tauriPath, options } = await this.getTauriFsArgs(parentPath);
    await mkdir(tauriPath, {
      ...options,
      recursive: true,
    });
  }

  private async toBytes(data: Blob | Uint8Array | string): Promise<Uint8Array> {
    if (data instanceof Uint8Array) {
      return data;
    }

    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }

    return new Uint8Array(await data.arrayBuffer());
  }

  async readDirectory(
    path: string,
    _options?: { sortBy?: string; sortOrder?: 'asc' | 'desc' },
  ): Promise<VfsEntry[]> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    const entries = await readDir(tauriPath, options);

    const normalizedPath = this.normalizePath(path);
    return await Promise.all(
      entries.map(async (entry) => {
        const name = entry.name ?? '';
        const entryPath = normalizedPath ? `${normalizedPath}/${name}` : name;

        let hasChildren: boolean | undefined;
        let hasDirectories: boolean | undefined;
        if (entry.isDirectory) {
          try {
            const { tauriPath: childTauriPath, options: childOptions } =
              await this.getTauriFsArgs(entryPath);
            const childEntries = await readDir(childTauriPath, childOptions);
            hasChildren = childEntries.length > 0;
            hasDirectories = childEntries.some((childEntry) => childEntry.isDirectory);
          } catch {
            hasChildren = false;
            hasDirectories = false;
          }
        }

        return {
          name,
          kind: entry.isDirectory ? 'directory' : 'file',
          path: entryPath,
          parentPath: normalizedPath || undefined,
          hasChildren,
          hasDirectories,
        } satisfies VfsEntry;
      }),
    );
  }

  async createDirectory(path: string): Promise<void> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    await mkdir(tauriPath, {
      ...options,
      recursive: true,
    });
  }

  async listEntryNames(path: string): Promise<string[]> {
    const entries = await this.readDirectory(path);
    return entries.map((entry) => entry.name);
  }

  async readFile(path: string): Promise<Blob> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    const bytes = await readFile(tauriPath, options);
    return new Blob([bytes]);
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    await this.ensureParentDirectory(path);
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    await writeFile(tauriPath, await this.toBytes(data), options);
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    await remove(tauriPath, {
      ...options,
      recursive,
    });
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    await this.ensureParentDirectory(targetPath);
    const source = await this.getTauriFsArgs(sourcePath);
    const target = await this.getTauriFsArgs(targetPath);
    await rename(source.tauriPath, target.tauriPath, {
      oldPathBaseDir: source.options.baseDir,
      newPathBaseDir: target.options.baseDir,
    });
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    await this.ensureParentDirectory(targetPath);
    const source = await this.getTauriFsArgs(sourcePath);
    const target = await this.getTauriFsArgs(targetPath);
    await copyFile(source.tauriPath, target.tauriPath, {
      fromPathBaseDir: source.options.baseDir,
      toPathBaseDir: target.options.baseDir,
    });
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    await this.createDirectory(targetPath);

    const entries = await this.readDirectory(sourcePath);
    for (const entry of entries) {
      const nextTargetPath = targetPath ? `${targetPath}/${entry.name}` : entry.name;

      if (entry.kind === 'directory') {
        await this.copyDirectory(entry.path, nextTargetPath);
      } else {
        await this.copyFile(entry.path, nextTargetPath);
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    return await exists(tauriPath, options);
  }

  async getMetadata(
    path: string,
  ): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null> {
    if (!(await this.exists(path))) {
      return null;
    }

    const { tauriPath, options } = await this.getTauriFsArgs(path);
    const metadata = await stat(tauriPath, options);

    return {
      size: metadata.size ?? 0,
      lastModified: metadata.mtime ? new Date(metadata.mtime).getTime() : Date.now(),
      kind: metadata.isDirectory ? 'directory' : 'file',
    };
  }

  async getObjectUrl(path: string): Promise<string> {
    const blob = await this.readFile(path);
    return URL.createObjectURL(blob);
  }

  async getFile(path: string): Promise<File | null> {
    const metadata = await this.getMetadata(path);
    if (!metadata || metadata.kind !== 'file') {
      return null;
    }

    const blob = await this.readFile(path);
    return new File([blob], this.getEntryName(path), {
      lastModified: metadata.lastModified,
      type: blob.type,
    });
  }

  async readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    return await openReadFileStream(await this.resolveStreamPath(path));
  }

  async writeStream(path: string): Promise<WritableStream<Uint8Array>> {
    const normalizedPath = this.normalizePath(path);
    await this.ensureParentDirectory(normalizedPath);
    return await openWriteFileStream(await this.resolveStreamPath(normalizedPath));
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  }
}
