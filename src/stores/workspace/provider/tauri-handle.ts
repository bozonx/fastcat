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
import { acquireStreamingFileIoSlot, withFileWriteSlot } from '~/utils/io/io-governor';
import { withTauriReadHandle } from '~/stores/workspace/provider/tauri-read-handle-pool';
import { randomToken } from '~/utils/ids';
import { openWriteFileStream } from 'tauri-plugin-fs-stream-api';
import { joinTauriFsPath } from '~/utils/tauri-local-path';
import { getMimeTypeFromFilename } from '~/utils/media-types';

const STREAM_WRITER_THRESHOLD_BYTES = 1024 * 1024;
export const LAZY_FILE_MEDIA_THRESHOLD_BYTES = 5 * 1024 * 1024;

const MEDIA_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'mkv',
  'webm',
  'avi',
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'opus',
  'm4a',
  'mka',
  'wmv',
  'm4v',
  '3gp',
  'ogv',
  'oga',
  'wma',
  'aiff',
  'au',
]);

export function isMediaFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MEDIA_EXTENSIONS.has(ext);
}

export function isLazyTauriFile(value: unknown): value is LazyTauriFile {
  return value instanceof LazyTauriFile;
}

export class LazyTauriFile extends File {
  readonly path: string;
  private _totalSize: number;
  private _start: number;
  private _end: number;

  constructor(params: {
    path: string;
    name: string;
    size: number;
    type?: string;
    lastModified?: number;
    start?: number;
    end?: number;
  }) {
    super([], params.name, {
      type: params.type ?? '',
      lastModified: params.lastModified ?? Date.now(),
    });
    this.path = params.path;
    this._totalSize = params.size;
    this._start = params.start ?? 0;
    this._end = params.end ?? params.size;
  }

  override get size(): number {
    return this._end - this._start;
  }

  override slice(start = 0, end = this.size, contentType?: string): Blob {
    const relativeStart = Math.max(0, this._start + start);
    const relativeEnd = Math.min(this._start + this.size, this._start + end);
    return new LazyTauriFile({
      path: this.path,
      name: this.name,
      size: this._totalSize,
      type: contentType ?? this.type,
      lastModified: this.lastModified,
      start: relativeStart,
      end: relativeEnd,
    });
  }

  override async arrayBuffer(): Promise<ArrayBuffer> {
    return withTauriReadHandle(this.path, async (handle) => {
      // Pooled handles carry an arbitrary cursor from their previous borrow, so
      // always seek to the absolute start of this range (including 0).
      await handle.seek(this._start, 0);
      const length = this.size;
      const result = new Uint8Array(length);
      let read = 0;
      while (read < length) {
        const chunk = await handle.read(result.subarray(read));
        if (chunk === null) break;
        read += chunk;
      }
      return result.buffer;
    });
  }

  override async text(): Promise<string> {
    const buf = await this.arrayBuffer();
    return new TextDecoder().decode(buf);
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull: async (controller) => {
        const chunk = await this.arrayBuffer();
        controller.enqueue(new Uint8Array(chunk) as Uint8Array<ArrayBuffer>);
        controller.close();
      },
    });
  }
}

export class TauriFileHandle {
  kind = 'file' as const;
  name: string;
  path: string;

  constructor(path: string, name: string) {
    this.path = path;
    this.name = name;
  }

  async getFile(): Promise<File> {
    const fileStat = await stat(this.path).catch(() => ({ mtime: Date.now(), size: 0 }));
    const size = fileStat.size ?? 0;
    const mimeType = getMimeTypeFromFilename(this.name);
    if (size > LAZY_FILE_MEDIA_THRESHOLD_BYTES && isMediaFile(this.name)) {
      return new LazyTauriFile({
        path: this.path,
        name: this.name,
        size,
        type: mimeType,
        lastModified: fileStat.mtime ? new Date(fileStat.mtime).getTime() : Date.now(),
      });
    }
    const bytes = await readFile(this.path);
    const blob = new Blob([bytes]);
    return new File([blob], this.name, {
      type: mimeType,
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
    const childPath = joinTauriFsPath(this.path, name);

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
    const childPath = joinTauriFsPath(this.path, name);
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
    const childPath = joinTauriFsPath(this.path, name);
    await remove(childPath, { recursive: options?.recursive });
  }

  async *values(): AsyncIterable<TauriDirectoryHandle | TauriFileHandle> {
    const entries = await readDir(this.path);
    for (const entry of entries) {
      const childPath = joinTauriFsPath(this.path, entry.name);
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
