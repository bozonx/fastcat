import type {
  IFileSystemAdapter,
  VfsEntry,
  VfsEntryMetadata,
  VfsOperationOptions,
  VfsReadDirectoryOptions,
} from './types';
import { copyDirectoryTree } from './copyTree';
import {
  VfsInvalidArgumentError,
  VfsNotFoundError,
  isCrossDeviceError,
  isNotFoundError,
  throwIfAborted,
  wrapPlatformError,
} from './errors';

import PQueue from 'p-queue';

import { convertFileSrc } from '@tauri-apps/api/core';
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

import { normalizeFsPath } from '~/file-manager/core/path';
import { withFileWriteSlot } from '~/utils/io/io-governor';
import { isTauriRuntime } from '~/utils/runtime';
import { randomToken } from '~/utils/ids';

/** Marker string for the Tauri AppData base directory. */
export const TAURI_APP_DATA_BASE_PATH = 'app-data';

const CHECK_CHILDREN_CONCURRENCY = 8;

/**
 * Discriminated base-path config: avoids magic-string comparisons across the
 * adapter and lets the host code be explicit about whether they want AppData
 * (Tauri's per-app sandbox) or an absolute on-disk path.
 */
export type TauriBase =
  | { type: 'app-data' }
  | { type: 'absolute'; path: string }
  | { type: 'lazy-absolute'; resolve: () => string | Promise<string> };

/**
 * Backwards-compatible constructor shape: string `'app-data'` selects AppData,
 * any other string is an absolute path, a function returns one of the above.
 */
export type TauriBaseInput =
  | TauriBase
  | string
  | (() => string | Promise<string>)
  | (() => TauriBase | Promise<TauriBase>);

function normalizeBaseInput(input: TauriBaseInput): TauriBase | (() => Promise<TauriBase>) {
  if (typeof input === 'string') {
    return input === TAURI_APP_DATA_BASE_PATH
      ? { type: 'app-data' }
      : { type: 'absolute', path: input };
  }
  if (typeof input === 'function') {
    return async () => {
      const value = await input();
      if (typeof value === 'string') {
        return value === TAURI_APP_DATA_BASE_PATH
          ? { type: 'app-data' }
          : { type: 'absolute', path: value };
      }
      return value;
    };
  }
  return input;
}

export class TauriFileSystemAdapter implements IFileSystemAdapter {
  id = 'tauri';
  private base: TauriBase | (() => Promise<TauriBase>);

  constructor(base: TauriBaseInput) {
    this.base = normalizeBaseInput(base);
  }

  private async resolveBase(): Promise<TauriBase> {
    if (typeof this.base === 'function') {
      return await this.base();
    }
    return this.base;
  }

  async init(): Promise<void> {
    if (!isTauriRuntime()) {
      throw new Error('Not running in Tauri environment');
    }

    const { tauriPath, options } = await this.getTauriFsArgs('');
    if (tauriPath === '.' || tauriPath === '' || tauriPath === '/') {
      return;
    }
    try {
      await mkdir(tauriPath, {
        ...options,
        recursive: true,
      });
    } catch (e) {
      console.error('[TauriFileSystemAdapter] mkdir failed:', { tauriPath, options, error: e });
      throw wrapPlatformError(e, tauriPath);
    }
  }

  private async getTauriFsArgs(
    path: string,
  ): Promise<{ tauriPath: string; options: { baseDir?: BaseDirectory } }> {
    const normalizedPath = this.normalizePath(path);
    const base = await this.resolveBase();

    if (base.type === 'app-data') {
      return {
        tauriPath: normalizedPath || '.',
        options: { baseDir: BaseDirectory.AppData },
      };
    }

    const basePath = base.type === 'absolute' ? base.path : await base.resolve();
    const tauriPath = normalizedPath ? await join(basePath, normalizedPath) : basePath;
    return {
      tauriPath,
      options: {},
    };
  }

  private normalizePath(path: string): string {
    return normalizeFsPath(path.replaceAll('\\', '/'));
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
    const base = await this.resolveBase();
    const baseDirPath =
      base.type === 'app-data'
        ? await appDataDir()
        : base.type === 'absolute'
          ? base.path
          : await base.resolve();
    return normalizedPath ? await join(baseDirPath, normalizedPath) : baseDirPath;
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const parentPath = this.getParentPath(path);
    if (!parentPath) {
      return;
    }

    const { tauriPath, options } = await this.getTauriFsArgs(parentPath);
    try {
      await mkdir(tauriPath, {
        ...options,
        recursive: true,
      });
    } catch (e) {
      throw wrapPlatformError(e, path);
    }
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

  private createTempName(baseName: string): string {
    const random = randomToken(6);
    return `.${baseName}.${Date.now().toString(36)}.${random}.tmp`;
  }

  async readDirectory(path: string, options?: VfsReadDirectoryOptions): Promise<VfsEntry[]> {
    throwIfAborted(options?.signal, path);
    const { tauriPath, options: tauriOptions } = await this.getTauriFsArgs(path);
    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(tauriPath, tauriOptions);
    } catch (e) {
      if (isNotFoundError(e)) return [];
      throw wrapPlatformError(e, path);
    }

    const normalizedPath = this.normalizePath(path);
    const queue = options?.checkChildren
      ? new PQueue({ concurrency: CHECK_CHILDREN_CONCURRENCY })
      : null;

    // Listen for abort to stop fanning out new checkChildren reads.
    const abortHandler = () => queue?.clear();
    if (queue && options?.signal) {
      if (options.signal.aborted) queue.clear();
      else options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      return await Promise.all(
        entries.map(async (entry) => {
          const name = entry.name ?? '';
          const entryPath = normalizedPath ? `${normalizedPath}/${name}` : name;

          let hasChildren: boolean | undefined;
          let hasDirectories: boolean | undefined;

          if (entry.isDirectory && queue) {
            const childStats = await queue.add(async () => {
              if (options?.signal?.aborted) return undefined;
              try {
                const { tauriPath: childTauriPath, options: childOptions } =
                  await this.getTauriFsArgs(entryPath);
                const childEntries = await readDir(childTauriPath, childOptions);
                return {
                  hasChildren: childEntries.length > 0,
                  hasDirectories: childEntries.some((childEntry) => childEntry.isDirectory),
                };
              } catch {
                return { hasChildren: false, hasDirectories: false };
              }
            });
            hasChildren = childStats?.hasChildren ?? false;
            hasDirectories = childStats?.hasDirectories ?? false;
          } else if (entry.isDirectory) {
            // Default: assume children might exist so the chevron renders.
            // Avoids O(N²) reads unless `checkChildren` is set.
            hasChildren = true;
            hasDirectories = true;
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
    } finally {
      options?.signal?.removeEventListener('abort', abortHandler);
    }
  }

  async createDirectory(path: string): Promise<void> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    try {
      await mkdir(tauriPath, {
        ...options,
        recursive: true,
      });
    } catch (e) {
      throw wrapPlatformError(e, path);
    }
  }

  async listEntryNames(path: string): Promise<string[]> {
    const entries = await this.readDirectory(path);
    return entries.map((entry) => entry.name);
  }

  async readFile(path: string, options?: VfsOperationOptions): Promise<Blob> {
    throwIfAborted(options?.signal, path);
    const { tauriPath, options: tauriOptions } = await this.getTauriFsArgs(path);
    try {
      const bytes = await readFile(tauriPath, tauriOptions);
      return new Blob([bytes]);
    } catch (e) {
      if (isNotFoundError(e)) throw new VfsNotFoundError(path, { cause: e });
      throw wrapPlatformError(e, path);
    }
  }

  /**
   * Writes a file atomically by staging bytes to a sibling temp file and
   * renaming it into place. The temp file is removed on failure so a botched
   * write does not litter the workspace.
   */
  async writeFile(
    path: string,
    data: Blob | Uint8Array | string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, path);
    await this.ensureParentDirectory(path);
    const parentPath = this.getParentPath(path);
    const fileName = this.getEntryName(path);
    if (!fileName) throw new VfsInvalidArgumentError(`Invalid file name in path: ${path}`);

    const tempRelative = parentPath
      ? `${parentPath}/${this.createTempName(fileName)}`
      : this.createTempName(fileName);

    const tempArgs = await this.getTauriFsArgs(tempRelative);
    const finalArgs = await this.getTauriFsArgs(path);

    const bytes = await this.toBytes(data);
    try {
      await withFileWriteSlot(() => writeFile(tempArgs.tauriPath, bytes, tempArgs.options));
      await withFileWriteSlot(() =>
        rename(tempArgs.tauriPath, finalArgs.tauriPath, {
          oldPathBaseDir: tempArgs.options.baseDir,
          newPathBaseDir: finalArgs.options.baseDir,
        }),
      );
    } catch (e) {
      await withFileWriteSlot(() => remove(tempArgs.tauriPath, tempArgs.options)).catch(() => {});
      throw wrapPlatformError(e, path);
    }
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    try {
      await remove(tauriPath, {
        ...options,
        recursive,
      });
    } catch (e) {
      if (isNotFoundError(e)) return;
      throw wrapPlatformError(e, path);
    }
  }

  async moveEntry(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    await this.ensureParentDirectory(targetPath);
    const source = await this.getTauriFsArgs(sourcePath);
    const target = await this.getTauriFsArgs(targetPath);
    try {
      await withFileWriteSlot(() =>
        rename(source.tauriPath, target.tauriPath, {
          oldPathBaseDir: source.options.baseDir,
          newPathBaseDir: target.options.baseDir,
        }),
      );
    } catch (e) {
      // EXDEV: source and target live on different filesystems → rename is not
      // possible. Fall back to copy + delete which works across mountpoints.
      if (isCrossDeviceError(e)) {
        const meta = await this.getMetadata(sourcePath);
        if (!meta) throw new VfsNotFoundError(sourcePath, { cause: e });
        if (meta.kind === 'directory') {
          await this.copyDirectory(sourcePath, targetPath, options);
        } else {
          await this.copyFile(sourcePath, targetPath, options);
        }
        await this.deleteEntry(sourcePath, true);
        return;
      }
      if (isNotFoundError(e)) throw new VfsNotFoundError(sourcePath, { cause: e });
      throw wrapPlatformError(e, sourcePath);
    }
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    await this.ensureParentDirectory(targetPath);
    const source = await this.getTauriFsArgs(sourcePath);
    const target = await this.getTauriFsArgs(targetPath);
    try {
      await withFileWriteSlot(() =>
        copyFile(source.tauriPath, target.tauriPath, {
          fromPathBaseDir: source.options.baseDir,
          toPathBaseDir: target.options.baseDir,
        }),
      );
    } catch (e) {
      if (isNotFoundError(e)) throw new VfsNotFoundError(sourcePath, { cause: e });
      throw wrapPlatformError(e, sourcePath);
    }
  }

  async copyDirectory(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    await copyDirectoryTree(
      {
        readDirectory: (path) => this.readDirectory(path),
        createDirectory: (path) => this.createDirectory(path),
        copyFile: (source, target, copyOptions) => this.copyFile(source, target, copyOptions),
      },
      sourcePath,
      targetPath,
      options,
    );
  }

  async exists(path: string): Promise<boolean> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    try {
      return await exists(tauriPath, options);
    } catch (e) {
      if (isNotFoundError(e)) return false;
      throw wrapPlatformError(e, path);
    }
  }

  async getMetadata(path: string): Promise<VfsEntryMetadata | null> {
    const { tauriPath, options } = await this.getTauriFsArgs(path);
    let metadata: Awaited<ReturnType<typeof stat>>;
    try {
      metadata = await stat(tauriPath, options);
    } catch (error: unknown) {
      if (isNotFoundError(error)) return null;
      throw wrapPlatformError(error, path);
    }

    // Treat missing mtime as unknown (0) rather than lying with Date.now().
    return {
      size: metadata.size ?? 0,
      lastModified: metadata.mtime ? new Date(metadata.mtime).getTime() : 0,
      createdAt: metadata.birthtime ? new Date(metadata.birthtime).getTime() : undefined,
      kind: metadata.isDirectory ? 'directory' : 'file',
    };
  }

  async getObjectUrl(path: string): Promise<string> {
    const absolutePath = await this.resolveStreamPath(path);
    const metadata = await this.getMetadata(path);
    const version = metadata?.lastModified ? `?v=${metadata.lastModified}` : '';
    return `${convertFileSrc(absolutePath)}${version}`;
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

  async readStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    throwIfAborted(options?.signal, path);
    try {
      return await openReadFileStream(await this.resolveStreamPath(path));
    } catch (e) {
      if (isNotFoundError(e)) throw new VfsNotFoundError(path, { cause: e });
      throw wrapPlatformError(e, path);
    }
  }

  async writeStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<WritableStream<Uint8Array>> {
    throwIfAborted(options?.signal, path);
    const normalizedPath = this.normalizePath(path);
    await this.ensureParentDirectory(normalizedPath);
    try {
      return await openWriteFileStream(await this.resolveStreamPath(normalizedPath));
    } catch (e) {
      throw wrapPlatformError(e, path);
    }
  }

  async writeJson(path: string, data: unknown, options?: VfsOperationOptions): Promise<void> {
    await this.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, options);
  }
}
