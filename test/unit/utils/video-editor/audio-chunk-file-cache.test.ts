// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  readAudioChunkFromFileCache,
  writeAudioChunkToFileCache,
} from '~/utils/video-editor/audio-chunk-file-cache';

class AudioBufferMock {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }

  copyToChannel(data: Float32Array, channel: number, offset = 0): void {
    this.channels[channel]?.set(data, offset);
  }
}

class AudioContextMock {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferMock {
    return new AudioBufferMock(numberOfChannels, length, sampleRate);
  }
}

class MemoryFileHandle {
  readonly kind = 'file';

  constructor(
    readonly name: string,
    private readonly files: Map<string, Uint8Array>,
  ) {}

  async getFile(): Promise<File> {
    const data = this.files.get(this.name);
    if (!data) throw new DOMException(`File ${this.name} not found`, 'NotFoundError');
    return new File([data], this.name, { lastModified: 1 });
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const name = this.name;
    const files = this.files;
    return {
      async write(data: FileSystemWriteChunkType) {
        const buffer = data instanceof ArrayBuffer ? data : await new Blob([data]).arrayBuffer();
        files.set(name, new Uint8Array(buffer));
      },
      async close() {},
      async abort() {},
    } as FileSystemWritableFileStream;
  }

  async move(_destination: unknown, name: string): Promise<void> {
    const data = this.files.get(this.name);
    if (!data) return;
    this.files.delete(this.name);
    this.files.set(name, data);
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory';
  readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Map<string, MemoryDirectoryHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException(`Directory ${name} not found`, 'NotFoundError');

    const dir = new MemoryDirectoryHandle(name);
    this.dirs.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException(`File ${name} not found`, 'NotFoundError');
    }
    return new MemoryFileHandle(name, this.files);
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
    this.dirs.delete(name);
  }
}

function createSourceFile(options?: { lastModified?: number; size?: number }): File {
  const bytes = new Uint8Array(options?.size ?? 8);
  return new File([bytes], 'source.wav', { lastModified: options?.lastModified ?? 10 });
}

describe('audio chunk file cache', () => {
  it('persists and restores a PCM chunk', async () => {
    const root = new MemoryDirectoryHandle('audio-cache') as unknown as FileSystemDirectoryHandle;
    const context = new AudioContextMock() as unknown as BaseAudioContext;
    const sourceFile = createSourceFile();
    const buffer = new AudioBufferMock(2, 4, 48_000);
    buffer.copyToChannel(new Float32Array([0.1, 0.2, 0.3, 0.4]), 0);
    buffer.copyToChannel(new Float32Array([-0.1, -0.2, -0.3, -0.4]), 1);

    await writeAudioChunkToFileCache({
      cacheRoot: root,
      sourceKey: 'source:_audio/test.wav',
      chunkIndex: 3,
      chunkSizeS: 5,
      sourceFile,
      chunk: {
        chunkIndex: 3,
        startTimeS: 15,
        durationS: 4 / 48_000,
        buffer: buffer as unknown as AudioBuffer,
      },
    });

    const restored = await readAudioChunkFromFileCache({
      cacheRoot: root,
      sourceKey: 'source:_audio/test.wav',
      chunkIndex: 3,
      chunkSizeS: 5,
      sourceFile,
      context,
    });

    expect(restored?.chunkIndex).toBe(3);
    expect(restored?.startTimeS).toBe(15);
    expect(Array.from(restored!.buffer.getChannelData(0))).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
      expect.closeTo(0.4),
    ]);
    expect(Array.from(restored!.buffer.getChannelData(1))).toEqual([
      expect.closeTo(-0.1),
      expect.closeTo(-0.2),
      expect.closeTo(-0.3),
      expect.closeTo(-0.4),
    ]);
  });

  it('misses when the source file stamp changes', async () => {
    const root = new MemoryDirectoryHandle('audio-cache') as unknown as FileSystemDirectoryHandle;
    const context = new AudioContextMock() as unknown as BaseAudioContext;
    const sourceFile = createSourceFile({ lastModified: 10 });
    const buffer = new AudioBufferMock(1, 2, 48_000);

    await writeAudioChunkToFileCache({
      cacheRoot: root,
      sourceKey: 'source:_audio/test.wav',
      chunkIndex: 0,
      chunkSizeS: 5,
      sourceFile,
      chunk: {
        chunkIndex: 0,
        startTimeS: 0,
        durationS: 2 / 48_000,
        buffer: buffer as unknown as AudioBuffer,
      },
    });

    const restored = await readAudioChunkFromFileCache({
      cacheRoot: root,
      sourceKey: 'source:_audio/test.wav',
      chunkIndex: 0,
      chunkSizeS: 5,
      sourceFile: createSourceFile({ lastModified: 11 }),
      context,
    });

    expect(restored).toBeNull();
  });
});
