/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { AudioChunkDecoder } from '~/utils/video-editor/AudioChunkDecoder';

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
