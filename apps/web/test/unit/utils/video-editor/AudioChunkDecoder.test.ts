/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { AudioChunkDecoder } from '~/utils/video-editor/AudioChunkDecoder';
import { DECODE_CANCELLED_MESSAGE } from '~/utils/video-editor/decode-worker-client';

function createDecoder(): AudioChunkDecoder {
  return new AudioChunkDecoder({
    getContext: () => null,
    collectPinnedBuffers: () => new Set(),
    chunkSizeS: 5,
  });
}

function createFileHandle(): FileSystemFileHandle {
  return {} as FileSystemFileHandle;
}

describe('AudioChunkDecoder.getForRange', () => {
  it('does not decode the next chunk when the range ends on its boundary', async () => {
    const decoder = createDecoder();
    const ensureDecoded = vi.spyOn(decoder, 'ensureDecoded').mockResolvedValue(null);

    await decoder.getForRange({
      sourceKey: 'audio.mp3',
      fileHandle: createFileHandle(),
      startTimeS: 0,
      durationS: 5,
    });

    expect(ensureDecoded).toHaveBeenCalledTimes(1);
    expect(ensureDecoded).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkIndex: 0,
      }),
    );
    decoder.destroy();
  });

  it('decodes the next chunk when the range crosses its boundary', async () => {
    const decoder = createDecoder();
    const ensureDecoded = vi.spyOn(decoder, 'ensureDecoded').mockResolvedValue(null);

    await decoder.getForRange({
      sourceKey: 'audio.mp3',
      fileHandle: createFileHandle(),
      startTimeS: 0,
      durationS: 5.001,
    });

    expect(ensureDecoded.mock.calls.map(([params]) => params.chunkIndex)).toEqual([0, 1]);
    decoder.destroy();
  });
});

describe('AudioChunkDecoder chunk key separator', () => {
  it('handles source keys with colons (Windows paths, URLs)', () => {
    const decoder = createDecoder();
    const sourceKey = 'C:\\Users\\test:audio.mp3';
    const chunkIndex = 3;

    // Access private methods via cast
    const getChunkKey = (decoder as any).getChunkKey.bind(decoder);
    const getSourceKeyFromChunkKey = (decoder as any).getSourceKeyFromChunkKey.bind(decoder);

    const chunkKey = getChunkKey(sourceKey, chunkIndex);
    const extractedSourceKey = getSourceKeyFromChunkKey(chunkKey);

    expect(extractedSourceKey).toBe(sourceKey);
    decoder.destroy();
  });

  it('handles source keys with URL-style colons', () => {
    const decoder = createDecoder();
    const sourceKey = 'https://example.com:8080/audio.wav';
    const chunkIndex = 10;

    const getChunkKey = (decoder as any).getChunkKey.bind(decoder);
    const getSourceKeyFromChunkKey = (decoder as any).getSourceKeyFromChunkKey.bind(decoder);

    const chunkKey = getChunkKey(sourceKey, chunkIndex);
    const extractedSourceKey = getSourceKeyFromChunkKey(chunkKey);

    expect(extractedSourceKey).toBe(sourceKey);
    decoder.destroy();
  });
});

describe('AudioChunkDecoder.handleDecodeError', () => {
  it('silently swallows DECODE_CANCELLED_MESSAGE without logging or marking as failed', () => {
    const decoder = createDecoder();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handleDecodeError = (decoder as any).handleDecodeError.bind(decoder);

    handleDecodeError({
      err: new Error(DECODE_CANCELLED_MESSAGE),
      chunkKey: 'source\x000',
      sourceKey: 'source',
    });

    expect(warnSpy).not.toHaveBeenCalled();
    const failedChunkKeys = (decoder as any).failedChunkKeys as Set<string>;
    expect(failedChunkKeys.has('source\x000')).toBe(false);
    warnSpy.mockRestore();
    decoder.destroy();
  });

  it('silently marks NoAudioTrackError as failed without logging', () => {
    const decoder = createDecoder();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handleDecodeError = (decoder as any).handleDecodeError.bind(decoder);

    const err = new Error('No audio track');
    err.name = 'NoAudioTrackError';

    handleDecodeError({
      err,
      chunkKey: 'video.mp4\x000',
      sourceKey: 'video.mp4',
    });

    expect(warnSpy).not.toHaveBeenCalled();
    const failedChunkKeys = (decoder as any).failedChunkKeys as Set<string>;
    expect(failedChunkKeys.has('video.mp4\x000')).toBe(true);
    warnSpy.mockRestore();
    decoder.destroy();
  });
});
