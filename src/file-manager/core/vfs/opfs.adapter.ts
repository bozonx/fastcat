import type {
  IFileSystemAdapter,
  VfsEntry,
  VfsEntryMetadata,
  VfsOperationOptions,
  VfsReadDirectoryOptions,
} from './types';
import { copyDirectoryViaTree } from './copyTree';
import { createGovernedReadStream } from './streaming';
import {
  VfsConflictError,
  VfsInvalidArgumentError,
  VfsNotFoundError,
  VfsPermissionError,
  throwIfAborted,
  wrapPlatformError,
} from './errors';
import { acquireQueuedFileAccess, runQueuedFileAccess } from '~/utils/file-access-queue';
import { withFileIoSlot, acquireStreamingFileIoSlot } from '~/utils/io/io-governor';
import { randomToken } from '~/utils/ids';

interface ExtendedDirectoryHandle extends FileSystemDirectoryHandle {
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface WritableFileStreamWithAbort extends FileSystemWritableFileStream {
  abort(): Promise<void>;
}

interface ExtendedFileHandle extends FileSystemFileHandle {
  createWritable(options?: unknown): Promise<WritableFileStreamWithAbort>;
}

interface ExtendedHandle extends FileSystemHandle {
  move?(parent: FileSystemDirectoryHandle, name: string): Promise<void>;
}

interface PermissionAwareHandle extends FileSystemHandle {
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/**
 * Maximum number of `URL.createObjectURL` URLs the adapter retains per instance.
 * Older entries are revoked LRU-style — this prevents thumbnail-heavy views from
 * leaking blob URLs over a long session.
 */
const MAX_TRACKED_OBJECT_URLS = 256;

function normalizeWritableData(data: Blob | Uint8Array | string): Blob | Uint8Array | string {
  if (!(data instanceof Uint8Array)) {
    return data;
  }

  if (typeof SharedArrayBuffer === 'undefined' || !(data.buffer instanceof SharedArrayBuffer)) {
    return data;
  }

  // FileSystemWritableFileStream.write doesn't support SharedArrayBuffer.
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Uint8Array(buffer);
}

export class OpfsFileSystemAdapter implements IFileSystemAdapter {
  id = 'opfs';

  // Insertion-ordered Map → cheap LRU: re-insert on access, drop oldest on overflow.
  private objectUrlsByPath = new Map<string, string>();

  constructor(private getProjectRoot: () => Promise<FileSystemDirectoryHandle | null>) {}

  private getFileAccessKey(path: string): string {
    return `opfs:${path || '/'}`;
  }

  private async getRoot(): Promise<FileSystemDirectoryHandle | null> {
    return await this.getProjectRoot();
  }

  async init(): Promise<void> {
    // No-op, we fetch root lazily
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
          if (options?.isFile !== undefined) {
            if (options.isFile) {
              return await currentDir.getFileHandle(part, { create: options?.create });
            }
            return await currentDir.getDirectoryHandle(part, { create: options?.create });
          }
          try {
            return await currentDir.getFileHandle(part);
          } catch (innerE: unknown) {
            if ((innerE as Error).name === 'TypeMismatchError') {
              return await currentDir.getDirectoryHandle(part);
            }
            throw innerE;
          }
        } else {
          currentDir = await currentDir.getDirectoryHandle(part, { create: options?.create });
        }
      } catch (e: unknown) {
        if ((e as Error).name === 'NotFoundError' || (e as Error).name === 'TypeMismatchError') {
          return null;
        }
        throw wrapPlatformError(e, path);
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

  private async ensureReadWritePermission(handle: FileSystemHandle, path: string): Promise<void> {
    const permissionHandle = handle as PermissionAwareHandle;
    if (
      typeof permissionHandle.queryPermission !== 'function' &&
      typeof permissionHandle.requestPermission !== 'function'
    ) {
      return;
    }

    const options = { mode: 'readwrite' as const };
    const current = await permissionHandle.queryPermission?.(options);
    if (current === 'granted') return;

    const next = await permissionHandle.requestPermission?.(options);
    if (next !== 'granted') {
      throw new VfsPermissionError(path);
    }
  }

  async readDirectory(path: string, options?: VfsReadDirectoryOptions): Promise<VfsEntry[]> {
    throwIfAborted(options?.signal, path);
    const handle = (await this.getHandleByPath(path, {
      isFile: false,
    })) as FileSystemDirectoryHandle | null;
    if (!handle) return [];

    const entries: VfsEntry[] = [];
    for await (const [name, entryHandle] of handle.entries()) {
      throwIfAborted(options?.signal, path);
      let hasChildren: boolean | undefined;
      let hasDirectories: boolean | undefined;

      if (entryHandle.kind === 'directory' && options?.checkChildren) {
        const dirHandle = entryHandle as FileSystemDirectoryHandle;
        try {
          hasChildren = false;
          hasDirectories = false;
          for await (const [, childHandle] of dirHandle.entries()) {
            hasChildren = true;
            if (childHandle.kind === 'directory') {
              hasDirectories = true;
              break;
            }
          }
        } catch {
          hasChildren = undefined;
          hasDirectories = undefined;
        }
      }

      entries.push({
        name,
        kind: entryHandle.kind === 'file' ? 'file' : 'directory',
        path: path && path !== '/' ? `${path}/${name}` : name,
        parentPath: path || undefined,
        hasChildren,
        hasDirectories,
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

  async readFile(path: string, options?: VfsOperationOptions): Promise<Blob> {
    throwIfAborted(options?.signal, path);
    return await runQueuedFileAccess({
      key: this.getFileAccessKey(path),
      task: async () => {
        const handle = (await this.getHandleByPath(path, {
          isFile: true,
        })) as FileSystemFileHandle | null;
        if (!handle) throw new VfsNotFoundError(path);
        try {
          return await withFileIoSlot(() => handle.getFile());
        } catch (e) {
          throw wrapPlatformError(e, path);
        }
      },
    });
  }

  /**
   * Writes a file.
   *
   * On browsers that expose `FileSystemFileHandle.move()` (Chromium-based) we
   * stage the bytes in a sibling temp file and move it into place — this is
   * the only way to make OPFS writes atomic, since `createWritable()` reveals
   * an empty file the moment it is opened. On browsers without `move()` (Safari
   * as of writing) we fall back to a direct write; we don't smuggle bytes
   * through a temp file in that case because the second write step is itself
   * non-atomic and just doubles the I/O for zero safety gain.
   */
  async writeFile(
    path: string,
    data: Blob | Uint8Array | string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, path);
    await runQueuedFileAccess({
      key: this.getFileAccessKey(path),
      task: async () => {
        await withFileIoSlot(async () => {
          const parentHandle = await this.getParentDirHandle(path, { create: true });
          if (!parentHandle) throw new VfsNotFoundError(path);
          await this.ensureReadWritePermission(parentHandle, path);

          const parts = path.split('/').filter(Boolean);
          const fileName = parts[parts.length - 1];
          if (!fileName) throw new VfsInvalidArgumentError(`Invalid file name in path: ${path}`);

          const supportsAtomicMove = await this.supportsHandleMove(parentHandle);

          if (!supportsAtomicMove) {
            try {
              const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });
              await this.ensureReadWritePermission(fileHandle, path);
              const writable = await (fileHandle as ExtendedFileHandle).createWritable();
              try {
                await writable.write(normalizeWritableData(data) as FileSystemWriteChunkType);
                await writable.close();
              } catch (writeErr) {
                try {
                  if (typeof writable.abort === 'function') {
                    await writable.abort();
                  } else {
                    await writable.close();
                  }
                } catch {
                  /* ignore */
                }
                throw writeErr;
              }
              this.revokeObjectUrlsUnder(path);
            } catch (e) {
              throw wrapPlatformError(e, path);
            }
            return;
          }

          const normalizedData = normalizeWritableData(data);

          const tempName = this.createTempName(fileName);
          let tempHandle: FileSystemFileHandle | null = null;
          try {
            tempHandle = await parentHandle.getFileHandle(tempName, { create: true });
            await this.ensureReadWritePermission(tempHandle, path);
            const writable = await (tempHandle as ExtendedFileHandle).createWritable();
            try {
              await writable.write(normalizedData as FileSystemWriteChunkType);
              await writable.close();
            } catch (e) {
              try {
                if (typeof writable.abort === 'function') {
                  await writable.abort();
                } else {
                  await writable.close();
                }
              } catch {
                /* ignore */
              }
              throw e;
            }

            await (tempHandle as ExtendedHandle).move!(parentHandle, fileName);
            this.revokeObjectUrlsUnder(path);
          } catch (e) {
            const isLocked =
              (e as Error).name === 'NoModificationAllowedError' ||
              (e as Error).message?.toLowerCase().includes('locked');

            if (isLocked) {
              // Destination is locked (another context has the file open).
              // Fall back to a direct overwrite — non-atomic, but the best we can do.
              try {
                const fileHandle = await parentHandle.getFileHandle(fileName, { create: true });
                await this.ensureReadWritePermission(fileHandle, path);
                const writable = await (fileHandle as ExtendedFileHandle).createWritable();
                try {
                  await writable.write(normalizedData as FileSystemWriteChunkType);
                  await writable.close();
                } catch (writeErr) {
                  try {
                    if (typeof writable.abort === 'function') {
                      await writable.abort();
                    } else {
                      await writable.close();
                    }
                  } catch {
                    /* ignore */
                  }
                  throw writeErr;
                }
                this.revokeObjectUrlsUnder(path);
              } catch (fallbackErr) {
                throw wrapPlatformError(fallbackErr, path);
              } finally {
                if (tempHandle) {
                  await (parentHandle as ExtendedDirectoryHandle)
                    .removeEntry(tempName)
                    .catch(() => {});
                }
              }
              return;
            }

            if (tempHandle) {
              await (parentHandle as ExtendedDirectoryHandle).removeEntry(tempName).catch(() => {});
            }
            throw wrapPlatformError(e, path);
          }
        });
      },
    });
  }

  private supportsHandleMoveCache = new WeakMap<FileSystemDirectoryHandle, boolean>();

  private async supportsHandleMove(parent: FileSystemDirectoryHandle): Promise<boolean> {
    const cached = this.supportsHandleMoveCache.get(parent);
    if (cached !== undefined) return cached;
    try {
      // Probe with a throwaway handle. `move` lives on FileSystemHandle in the
      // spec — touch a real handle to avoid false positives from polyfills.
      const probeName = `.opfs-move-probe.${Date.now().toString(36)}`;
      const probe = await parent.getFileHandle(probeName, { create: true });
      const has = typeof (probe as ExtendedHandle).move === 'function';
      await (parent as ExtendedDirectoryHandle).removeEntry(probeName).catch(() => {});
      this.supportsHandleMoveCache.set(parent, has);
      return has;
    } catch {
      this.supportsHandleMoveCache.set(parent, false);
      return false;
    }
  }

  private createTempName(baseName: string): string {
    const random = randomToken(6);
    return `.${baseName}.${Date.now().toString(36)}.${random}.tmp`;
  }

  async deleteEntry(path: string, recursive?: boolean): Promise<void> {
    await runQueuedFileAccess({
      key: this.getFileAccessKey(path),
      task: async () => {
        const parentHandle = await this.getParentDirHandle(path);
        if (!parentHandle) return; // parent doesn't exist, nothing to delete

        const parts = path.split('/').filter(Boolean);
        const name = parts[parts.length - 1];
        if (!name) return; // root or empty path

        // Revoke before removing so consumers can't accidentally race a stale URL
        // against an entry that's already on its way out.
        this.revokeObjectUrlsUnder(path);

        try {
          await (parentHandle as ExtendedDirectoryHandle).removeEntry(name, { recursive });
        } catch (e: unknown) {
          const errorName = (e as Error).name;
          if (errorName === 'NotFoundError') return;
          if (errorName === 'InvalidModificationError') {
            throw new VfsConflictError(path, `Directory is not empty: ${path}`, { cause: e });
          }
          throw wrapPlatformError(e, path);
        }
      },
    });
  }

  private trackObjectUrl(path: string, url: string): void {
    // Bump LRU position: delete + reinsert puts this entry at the tail.
    const previousUrl = this.objectUrlsByPath.get(path);
    this.objectUrlsByPath.delete(path);
    this.objectUrlsByPath.set(path, url);

    // Revoke asynchronously so any in-flight render can finish using the URL.
    if (previousUrl) {
      requestAnimationFrame(() => URL.revokeObjectURL(previousUrl));
    }

    while (this.objectUrlsByPath.size > MAX_TRACKED_OBJECT_URLS) {
      const oldestKey = this.objectUrlsByPath.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestUrl = this.objectUrlsByPath.get(oldestKey)!;
      requestAnimationFrame(() => URL.revokeObjectURL(oldestUrl));
      this.objectUrlsByPath.delete(oldestKey);
    }
  }

  private revokeObjectUrlsUnder(path: string): void {
    if (!path) return;
    const prefix = `${path}/`;
    const toRevoke: string[] = [];
    for (const [key, url] of this.objectUrlsByPath) {
      if (key === path || key.startsWith(prefix)) {
        toRevoke.push(url);
        this.objectUrlsByPath.delete(key);
      }
    }
    if (toRevoke.length > 0) {
      requestAnimationFrame(() => {
        for (const url of toRevoke) {
          URL.revokeObjectURL(url);
        }
      });
    }
  }

  /** @internal Test hook: number of tracked object URLs. */
  _trackedObjectUrlCount(): number {
    return this.objectUrlsByPath.size;
  }

  async copyFile(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);
    if (!(await this.exists(sourcePath))) {
      throw new VfsNotFoundError(sourcePath);
    }

    // Re-check abort after the async existence check so a late cancellation still triggers.
    throwIfAborted(options?.signal, sourcePath);

    const file = await this.getFile(sourcePath);
    if (!file) {
      throw new VfsNotFoundError(sourcePath);
    }
    await this.writeFile(targetPath, file, options);
  }

  async copyDirectory(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    await copyDirectoryViaTree(this, sourcePath, targetPath, options);
  }

  async moveEntry(
    sourcePath: string,
    targetPath: string,
    options?: VfsOperationOptions,
  ): Promise<void> {
    throwIfAborted(options?.signal, sourcePath);

    const sourceHandle = await this.getHandleByPath(sourcePath);
    if (!sourceHandle) throw new VfsNotFoundError(sourcePath);

    const targetParentHandle = await this.getParentDirHandle(targetPath, { create: true });
    if (!targetParentHandle) throw new VfsNotFoundError(targetPath);

    const targetParts = targetPath.split('/').filter(Boolean);
    const targetName = targetParts[targetParts.length - 1];
    if (!targetName) throw new VfsInvalidArgumentError(`Invalid target path: ${targetPath}`);

    // Best-effort: refuse to overwrite a different existing entry.
    if (await this.exists(targetPath)) {
      throw new VfsConflictError(targetPath, `Target already exists: ${targetPath}`);
    }

    // Object URLs for source paths become stale on move — revoke before mutating.
    this.revokeObjectUrlsUnder(sourcePath);

    if ((sourceHandle as ExtendedHandle).move) {
      try {
        await (sourceHandle as ExtendedHandle).move!(targetParentHandle, targetName);
        return;
      } catch (e) {
        throw wrapPlatformError(e, sourcePath);
      }
    }

    // Fallback: copy then verify via size comparison before deleting the source.
    const sourceMeta = await this.getMetadata(sourcePath);

    if (sourceHandle.kind === 'directory') {
      await this.copyDirectory(sourcePath, targetPath, options);
    } else {
      await this.copyFile(sourcePath, targetPath, options);
    }

    const targetMeta = await this.getMetadata(targetPath);
    if (!targetMeta) {
      throw new Error(`Move verification failed: target not found after copy: ${targetPath}`);
    }
    if (sourceMeta && sourceMeta.kind === 'file' && sourceMeta.size !== targetMeta.size) {
      throw new Error(
        `Move verification failed: size mismatch ${sourceMeta.size} → ${targetMeta.size}`,
      );
    }
    await this.deleteEntry(sourcePath, true);
  }

  async exists(path: string): Promise<boolean> {
    const handle = await this.getHandleByPath(path);
    return !!handle;
  }

  async getMetadata(path: string): Promise<VfsEntryMetadata | null> {
    return await runQueuedFileAccess({
      key: this.getFileAccessKey(path),
      task: async () => {
        const handle = await this.getHandleByPath(path);
        if (!handle) return null;

        if (handle.kind === 'file') {
          try {
            const file = await withFileIoSlot(() => (handle as FileSystemFileHandle).getFile());
            return {
              size: file.size,
              lastModified: file.lastModified,
              kind: 'file',
            };
          } catch (e) {
            throw wrapPlatformError(e, path);
          }
        }
        // OPFS doesn't expose directory mtime cheaply; report 0 instead of lying with Date.now().
        return {
          size: 0,
          lastModified: 0,
          kind: 'directory',
        };
      },
    });
  }

  async getObjectUrl(path: string): Promise<string> {
    const blob = await this.readFile(path);
    const previousUrl = this.objectUrlsByPath.get(path);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      this.objectUrlsByPath.delete(path);
    }
    const nextUrl = URL.createObjectURL(blob);
    this.trackObjectUrl(path, nextUrl);
    return nextUrl;
  }

  async getFile(path: string): Promise<File | null> {
    return await runQueuedFileAccess({
      key: this.getFileAccessKey(path),
      task: async () => {
        const handle = (await this.getHandleByPath(path, {
          isFile: true,
        })) as FileSystemFileHandle | null;
        if (!handle) return null;
        try {
          return await withFileIoSlot(() => handle.getFile());
        } catch (e) {
          throw wrapPlatformError(e, path);
        }
      },
    });
  }

  async readStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<ReadableStream<Uint8Array>> {
    throwIfAborted(options?.signal, path);
    const file = await this.getFile(path);
    if (!file) throw new VfsNotFoundError(path);
    const releaseIo = await acquireStreamingFileIoSlot();
    const reader = file.stream().getReader();
    return createGovernedReadStream(reader, { releaseIo, signal: options?.signal, path });
  }

  async writeStream(
    path: string,
    options?: VfsOperationOptions,
  ): Promise<WritableStream<Uint8Array>> {
    throwIfAborted(options?.signal, path);
    const releasePath = await acquireQueuedFileAccess(this.getFileAccessKey(path));
    const releaseIo = await acquireStreamingFileIoSlot();
    const parentHandle = await this.getParentDirHandle(path, { create: true });
    let tempName = '';
    let tempHandle: FileSystemFileHandle | null = null;
    try {
      if (!parentHandle) throw new VfsNotFoundError(path);
      await this.ensureReadWritePermission(parentHandle, path);

      const parts = path.split('/').filter(Boolean);
      const fileName = parts[parts.length - 1];
      if (!fileName) throw new VfsInvalidArgumentError(`Invalid file name in path: ${path}`);

      const supportsAtomicMove = await this.supportsHandleMove(parentHandle);
      tempName = supportsAtomicMove ? this.createTempName(fileName) : fileName;
      tempHandle = await parentHandle.getFileHandle(tempName, { create: true });
      await this.ensureReadWritePermission(tempHandle, path);
      const writable = (await (
        tempHandle as ExtendedFileHandle
      ).createWritable()) as unknown as WritableStream<Uint8Array>;
      const writer = writable.getWriter();
      let pathReleased = false;
      let ioReleased = false;
      let closed = false;
      const releasePathOnce = () => {
        if (pathReleased) return;
        pathReleased = true;
        releasePath();
      };
      const releaseIoOnce = () => {
        if (ioReleased) return;
        ioReleased = true;
        releaseIo();
      };
      const cleanupTemp = async () => {
        if (!tempName || tempName === fileName || closed) return;
        await (parentHandle as ExtendedDirectoryHandle).removeEntry(tempName).catch(() => {});
      };

      return new WritableStream<Uint8Array>({
        write: async (chunk) => {
          throwIfAborted(options?.signal, path);
          await writer.write(chunk);
        },
        close: async () => {
          try {
            await writer.close();
            if (tempName !== fileName) {
              await (tempHandle as ExtendedHandle).move!(parentHandle, fileName);
            }
            closed = true;
            this.revokeObjectUrlsUnder(path);
          } catch (e) {
            await cleanupTemp();
            throw e;
          } finally {
            releasePathOnce();
            releaseIoOnce();
          }
        },
        abort: async (reason) => {
          try {
            await writer.abort(reason);
            await cleanupTemp();
          } finally {
            releasePathOnce();
            releaseIoOnce();
          }
        },
      });
    } catch (e) {
      if (parentHandle && tempName) {
        await (parentHandle as ExtendedDirectoryHandle).removeEntry(tempName).catch(() => {});
      }
      releasePath();
      releaseIo();
      throw e;
    }
  }

  async writeJson(path: string, data: unknown, options?: VfsOperationOptions): Promise<void> {
    await this.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, options);
  }
}
