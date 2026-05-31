// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  readAudioChunkFromFileCache,
  writeAudioChunkToFileCache,
} from '~/utils/video-editor/audio-chunk-file-cache';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

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

function createSourceFile(options?: { lastModified?: number; size?: number }): File {
  const bytes = new Uint8Array(options?.size ?? 8);
  return new File([bytes], 'source.wav', { lastModified: options?.lastModified ?? 10 });
}

describe('audio chunk file cache', () => {
  it('persists and restores a PCM chunk', async () => {
    const vfs = new InMemoryFileSystemAdapter();
    const cacheVfsPath = '@ptemp/projects/project-1/audio-cache';
    const context = new AudioContextMock() as unknown as BaseAudioContext;
    const sourceFile = createSourceFile();
    const buffer = new AudioBufferMock(2, 4, 48_000);
    buffer.copyToChannel(new Float32Array([0.1, 0.2, 0.3, 0.4]), 0);
    buffer.copyToChannel(new Float32Array([-0.1, -0.2, -0.3, -0.4]), 1);

    await writeAudioChunkToFileCache({
      vfs,
      cacheVfsPath,
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
      vfs,
      cacheVfsPath,
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
    const vfs = new InMemoryFileSystemAdapter();
    const cacheVfsPath = '@ptemp/projects/project-1/audio-cache';
    const context = new AudioContextMock() as unknown as BaseAudioContext;
    const sourceFile = createSourceFile({ lastModified: 10 });
    const buffer = new AudioBufferMock(1, 2, 48_000);

    await writeAudioChunkToFileCache({
      vfs,
      cacheVfsPath,
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
      vfs,
      cacheVfsPath,
      sourceKey: 'source:_audio/test.wav',
      chunkIndex: 0,
      chunkSizeS: 5,
      sourceFile: createSourceFile({ lastModified: 11 }),
      context,
    });

    expect(restored).toBeNull();
  });
});
