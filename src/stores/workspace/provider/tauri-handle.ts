import {
  mkdir,
  readDir,
  readFile,
  writeFile,
  remove,
  stat,
  exists,
  rename,
} from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { acquireStreamingFileIoSlot, withFileWriteSlot } from '~/utils/io/io-governor';
import { randomToken } from '~/utils/ids';
import { openWriteFileStream } from 'tauri-plugin-fs-stream-api';

const STREAM_WRITER_THRESHOLD_BYTES = 1024 * 1024;

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

  async createWritable(options?: { keepExistingData?: boolean }): Promise<{
    write: (data: unknown) => Promise<void>;
    seek: (position: number) => Promise<void>;
    truncate: (size: number) => Promise<void>;
    close: () => Promise<void>;
    abort: (reason?: unknown) => Promise<void>;
  }> {
    const random = randomToken(6);
    const tempPath = `${this.path}.${Date.now().toString(36)}.${random}.tmp`;

    type WriteMode = 'pending' | 'stream' | 'buffer';
    let mode: WriteMode = 'pending';
    let streamWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let releaseStreamSlot: (() => void) | null = null;
    let buffer = new Uint8Array(0);
    let fileSize = 0;
    let position = 0;

    const ensureBufferMode = async () => {
      if (mode === 'buffer') return;
      if (mode === 'stream') {
        throw new Error('Cannot seek or truncate after streaming writes have started');
      }
      mode = 'buffer';
      if (options?.keepExistingData !== false && (await exists(this.path))) {
        try {
          buffer = await readFile(this.path);
          fileSize = buffer.length;
        } catch {
          // Ignore and start empty if file read fails
        }
      }
    };

    const ensureStreamMode = async () => {
      if (mode === 'stream') return;
      if (mode === 'buffer') return;
      mode = 'stream';
      releaseStreamSlot = await acquireStreamingFileIoSlot();
      try {
        const stream = await openWriteFileStream(tempPath);
        streamWriter = stream.getWriter();
      } catch (error) {
        releaseStreamSlot();
        releaseStreamSlot = null;
        mode = 'pending';
        throw error;
      }
    };

    const promoteAppendBufferToStreamIfLarge = async () => {
      if (mode !== 'buffer') return;
      if (options?.keepExistingData !== false) return;
      if (fileSize < STREAM_WRITER_THRESHOLD_BYTES) return;
      if (position !== fileSize) return;

      const finalData = buffer.subarray(0, fileSize);
      mode = 'stream';
      releaseStreamSlot = await acquireStreamingFileIoSlot();
      try {
        const stream = await openWriteFileStream(tempPath);
        streamWriter = stream.getWriter();
        await streamWriter.write(finalData);
      } catch (error) {
        releaseStreamSlot();
        releaseStreamSlot = null;
        mode = 'buffer';
        throw error;
      }
      buffer = new Uint8Array(0);
      fileSize = 0;
      position = 0;
    };

    const toUint8Array = async (data: unknown): Promise<Uint8Array> => {
      if (typeof data === 'string') {
        return new TextEncoder().encode(data);
      }
      if (data instanceof Uint8Array) {
        return data;
      }
      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }
      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      if (data instanceof Blob) {
        return new Uint8Array(await data.arrayBuffer());
      }
      return new Uint8Array(await new Blob([data as BlobPart]).arrayBuffer());
    };

    const truncateInternal = (size: number) => {
      if (size < buffer.length) {
        buffer = buffer.slice(0, size);
      } else if (size > buffer.length) {
        const newBuffer = new Uint8Array(size);
        newBuffer.set(buffer);
        buffer = newBuffer;
      }
      fileSize = size;
      if (position > size) {
        position = size;
      }
    };

    const writeInternal = async (data: unknown) => {
      const bytes = await toUint8Array(data);
      const neededLength = position + bytes.length;
      if (neededLength > buffer.length) {
        const newBuffer = new Uint8Array(Math.max(neededLength, buffer.length * 2));
        newBuffer.set(buffer);
        buffer = newBuffer;
      }
      buffer.set(bytes, position);
      position = neededLength;
      fileSize = Math.max(fileSize, neededLength);
    };

    return {
      write: async (data: unknown) => {
        if (data && typeof data === 'object' && 'type' in data) {
          await ensureBufferMode();
          const params = data as {
            type: 'write' | 'seek' | 'truncate';
            position?: number;
            size?: number;
            data?: unknown;
          };

          if (params.type === 'seek') {
            if (params.position !== undefined) {
              position = params.position;
            }
            return;
          }

          if (params.type === 'truncate') {
            if (params.size !== undefined) {
              truncateInternal(params.size);
            }
            return;
          }

          if (params.type === 'write') {
            if (params.position !== undefined) {
              position = params.position;
            }
            if (params.data !== undefined) {
              await writeInternal(params.data);
            }
            return;
          }
        }

        if (mode === 'buffer') {
          await writeInternal(data);
          await promoteAppendBufferToStreamIfLarge();
          return;
        }

        if (mode === 'stream') {
          await streamWriter!.write(await toUint8Array(data));
          return;
        }

        await ensureBufferMode();
        await writeInternal(data);
        await promoteAppendBufferToStreamIfLarge();
      },
      seek: async (pos: number) => {
        await ensureBufferMode();
        position = pos;
      },
      truncate: async (size: number) => {
        await ensureBufferMode();
        truncateInternal(size);
      },
      close: async () => {
        try {
          if (mode === 'stream') {
            await streamWriter?.close();
            releaseStreamSlot?.();
            releaseStreamSlot = null;
          } else {
            await ensureBufferMode();
            const finalData = buffer.subarray(0, fileSize);
            await withFileWriteSlot(() => writeFile(tempPath, finalData));
          }
          await withFileWriteSlot(() => rename(tempPath, this.path));
        } catch (error) {
          releaseStreamSlot?.();
          releaseStreamSlot = null;
          await remove(tempPath).catch(() => {});
          throw error;
        }
      },
      abort: async (reason?: unknown) => {
        try {
          if (mode === 'stream') {
            await streamWriter?.abort(reason);
          }
        } finally {
          releaseStreamSlot?.();
          releaseStreamSlot = null;
          await remove(tempPath).catch(() => {});
        }
      },
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

    if (name.startsWith('.')) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('allow_path_scope', { path: childPath }).catch(() => {});
    }

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
