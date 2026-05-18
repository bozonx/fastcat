/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { crossVfsCopy } from '~/file-manager/core/vfs/crossVfs';

describe('crossVfsCopy', () => {
  it('sanitizes invalid local filename characters when copying into project vfs', async () => {
    const sourceVfs = {
      id: 'bloggerdog',
      readStream: vi.fn().mockResolvedValue(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('hello'));
            controller.close();
          },
        }),
      ),
    } as any;
    const writtenChunks: Uint8Array[] = [];
    const targetVfs = {
      id: 'router',
      listEntryNames: vi.fn().mockResolvedValue([]),
      writeStream: vi.fn().mockResolvedValue(
        new WritableStream<Uint8Array>({
          write(chunk) {
            writtenChunks.push(chunk);
          },
        }),
      ),
    } as any;

    const result = await crossVfsCopy({
      sourceVfs,
      targetVfs,
      sourcePath: '/personal/Personal: Quick snippet/Personal: Quick snippet.txt',
      sourceKind: 'file',
      targetDirPath: 'documents',
    });

    expect(targetVfs.writeStream).toHaveBeenCalledWith('documents/Personal- Quick snippet.txt');
    expect(new TextDecoder().decode(writtenChunks[0])).toBe('hello');
    expect(result).toBe('documents/Personal- Quick snippet.txt');
  });
});
