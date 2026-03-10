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

export class TauriFileSystemAdapter implements IFileSystemAdapter {
  id = 'tauri';
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async init(): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      throw new Error('Not running in Tauri environment');
    }

    await mkdir('', {
      baseDir: this.getBaseDirectory(),
      recursive: true,
    }).catch(() => undefined);
  }

  private getBaseDirectory(): BaseDirectory {
    if (this.basePath === 'app-data') {
      return BaseDirectory.AppData;
    }

    throw new Error(`Unsupported Tauri base path: ${this.basePath}`);
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
    const baseDirPath = await appDataDir();
    return normalizedPath ? await join(baseDirPath, normalizedPath) : baseDirPath;
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const parentPath = this.getParentPath(path);
    if (!parentPath) {
      return;
    }

    await mkdir(parentPath, {
      baseDir: this.getBaseDirectory(),
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

  async readDirectory(path: string): Promise<VfsEntry[]> {
    const normalizedPath = this.normalizePath(path);
    const entries = await readDir(normalizedPath, {
      baseDir: this.getBaseDirectory(),
    });

    return entries.map((entry) => {
      const name = entry.name ?? '';
      const entryPath = normalizedPath ? `${normalizedPath}/${name}` : name;

      return {
        name,
        kind: entry.isDirectory ? 'directory' : 'file',
        path: entryPath,
        parentPath: normalizedPath || undefined,
      } satisfies VfsEntry;
    });
  }

  async createDirectory(path: string): Promise<void> {
    await mkdir(this.normalizePath(path), {
      baseDir: this.getBaseDirectory(),
      recursive: true,
    });
  }

  async listEntryNames(path: string): Promise<string[]> {
    const entries = await this.readDirectory(path);
    return entries.map((entry) => entry.name);
  }

  async readFile(path: string): Promise<Blob> {
    const normalizedPath = this.normalizePath(path);
    const bytes = await readFile(normalizedPath, {
      baseDir: this.getBaseDirectory(),
    });
    return new Blob([bytes]);
  }

  async writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    await this.ensureParentDirectory(normalizedPath);
    await writeFile(normalizedPath, await this.toBytes(data), {
      baseDir: this.getBaseDirectory(),
    });
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    await remove(this.normalizePath(path), {
      baseDir: this.getBaseDirectory(),
      recursive,
    });
  }

  async moveEntry(sourcePath: string, targetPath: string): Promise<void> {
    const normalizedSourcePath = this.normalizePath(sourcePath);
    const normalizedTargetPath = this.normalizePath(targetPath);

    await this.ensureParentDirectory(normalizedTargetPath);
    await rename(normalizedSourcePath, normalizedTargetPath, {
      oldPathBaseDir: this.getBaseDirectory(),
      newPathBaseDir: this.getBaseDirectory(),
    });
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    const normalizedSourcePath = this.normalizePath(sourcePath);
    const normalizedTargetPath = this.normalizePath(targetPath);

    await this.ensureParentDirectory(normalizedTargetPath);
    await copyFile(normalizedSourcePath, normalizedTargetPath, {
      fromPathBaseDir: this.getBaseDirectory(),
      toPathBaseDir: this.getBaseDirectory(),
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
    return await exists(this.normalizePath(path), {
      baseDir: this.getBaseDirectory(),
    });
  }

  async getMetadata(
    path: string,
  ): Promise<{ size: number; lastModified: number; kind: 'file' | 'directory' } | null> {
    const normalizedPath = this.normalizePath(path);
    if (!(await this.exists(normalizedPath))) {
      return null;
    }

    const metadata = await stat(normalizedPath, {
      baseDir: this.getBaseDirectory(),
    });

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
