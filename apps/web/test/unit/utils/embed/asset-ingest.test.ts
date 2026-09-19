/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { downloadAssetToFile } from '~/utils/embed/asset-ingest';
import type { EmbedAssetTransport } from '~/utils/embed/asset-transport';

function createHandle() {
  const writable = {
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  };
  const fileHandle = {
    createWritable: vi.fn(async () => writable),
  } as unknown as FileSystemFileHandle;
  return { writable, fileHandle };
}

function createTransport(read: EmbedAssetTransport['readRange']): EmbedAssetTransport {
  return {
    id: 'a',
    getSize: async () => 8,
    getContentType: async () => 'video/mp4',
    readRange: read,
    dispose: () => undefined,
  };
}

describe('downloadAssetToFile', () => {
  it('commits the file once every byte has arrived', async () => {
    const { writable, fileHandle } = createHandle();
    const transport = createTransport(async (start, end) => new Uint8Array(end - start));

    await expect(downloadAssetToFile({ transport, fileHandle })).resolves.toBe(8);
    expect(writable.close).toHaveBeenCalledOnce();
    expect(writable.abort).not.toHaveBeenCalled();
  });

  it('discards a download that failed half way instead of committing it', async () => {
    const { writable, fileHandle } = createHandle();
    const transport = createTransport(async () => {
      throw new Error('network');
    });

    await expect(downloadAssetToFile({ transport, fileHandle })).rejects.toThrow('network');
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
  });
});
