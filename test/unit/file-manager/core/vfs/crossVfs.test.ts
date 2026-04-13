/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { crossVfsCopy } from '~/file-manager/core/vfs/crossVfs';

describe('crossVfsCopy', () => {
  it('sanitizes invalid local filename characters when copying into project vfs', async () => {
    const sourceVfs = {
      id: 'bloggerdog',
      readFile: vi.fn().mockResolvedValue(new Blob(['hello'], { type: 'text/plain' })),
    } as any;
    const targetVfs = {
      id: 'router',
      listEntryNames: vi.fn().mockResolvedValue([]),
      writeFile: vi.fn().mockResolvedValue(undefined),
    } as any;

    const result = await crossVfsCopy({
      sourceVfs,
      targetVfs,
      sourcePath: '/personal/Personal: Quick snippet/Personal: Quick snippet.txt',
      sourceKind: 'file',
      targetDirPath: 'documents',
    });

    expect(targetVfs.writeFile).toHaveBeenCalledWith(
      'documents/Personal- Quick snippet.txt',
      expect.any(Blob),
    );
    expect(result).toBe('documents/Personal- Quick snippet.txt');
  });
});
