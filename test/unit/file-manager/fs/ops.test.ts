/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyFileToDirectory } from '~/file-manager/fs/ops';

const withFileIoSlotMock = vi.fn(async (task: () => Promise<unknown>) => task());
const withFileWriteSlotMock = vi.fn(async (task: () => Promise<unknown>) => task());

vi.mock('~/utils/io/io-governor', () => ({
  withFileIoSlot: (task: () => Promise<unknown>) => withFileIoSlotMock(task),
  withFileWriteSlot: (task: () => Promise<unknown>) => withFileWriteSlotMock(task),
}));

describe('copyFileToDirectory', () => {
  beforeEach(() => {
    withFileIoSlotMock.mockClear();
    withFileWriteSlotMock.mockClear();
  });
  it('copies file through the write governor slot', async () => {
    const mockFile = new File(['hello'], 'source.txt');
    const sourceHandle = {
      getFile: vi.fn().mockResolvedValue(mockFile),
    } as any;

    const mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const targetDirHandle = {
      getFileHandle: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      }),
    } as any;

    await copyFileToDirectory({
      sourceHandle,
      fileName: 'dest.txt',
      targetDirHandle,
    });

    expect(withFileWriteSlotMock).toHaveBeenCalledTimes(1);
    expect(targetDirHandle.getFileHandle).toHaveBeenCalledWith('dest.txt', { create: true });
    expect(mockWritable.write).toHaveBeenCalledWith(mockFile);
    expect(mockWritable.close).toHaveBeenCalled();
  });

  it('throws when createWritable is not available', async () => {
    const sourceHandle = {
      getFile: vi.fn().mockResolvedValue(new File([], 'test.txt')),
    } as any;

    const targetDirHandle = {
      getFileHandle: vi.fn().mockResolvedValue({}),
    } as any;

    await expect(
      copyFileToDirectory({
        sourceHandle,
        fileName: 'dest.txt',
        targetDirHandle,
      }),
    ).rejects.toThrow('createWritable is not available');
  });

  it('serializes concurrent copies via the write slot', async () => {
    let slotCount = 0;
    withFileWriteSlotMock.mockImplementation(async (task: () => Promise<unknown>) => {
      slotCount += 1;
      const result = await task();
      slotCount -= 1;
      return result;
    });

    const mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const sourceHandle = {
      getFile: vi.fn().mockResolvedValue(new File(['a'], 'a.txt')),
    } as any;

    const targetDirHandle = {
      getFileHandle: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      }),
    } as any;

    await Promise.all([
      copyFileToDirectory({ sourceHandle, fileName: '1.txt', targetDirHandle }),
      copyFileToDirectory({ sourceHandle, fileName: '2.txt', targetDirHandle }),
    ]);

    expect(withFileWriteSlotMock).toHaveBeenCalledTimes(2);
  });
});
