/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveAudioChannelsFromMeta,
  resolveAudioOnlyContainerFormat,
  resolveAudioOnlyFileExtension,
  clampPositiveNumber,
  isAbortError,
  removeCreatedFile,
  resolveUniqueFileName,
} from '~/utils/conversion/helpers';

describe('resolveAudioChannelsFromMeta', () => {
  it('returns 2 for falsy values', () => {
    expect(resolveAudioChannelsFromMeta(0)).toBe(2);
    expect(resolveAudioChannelsFromMeta(undefined)).toBe(2);
  });

  it('returns the value if truthy', () => {
    expect(resolveAudioChannelsFromMeta(1)).toBe(1);
    expect(resolveAudioChannelsFromMeta(6)).toBe(6);
  });
});

describe('resolveAudioOnlyContainerFormat', () => {
  it('returns webm for opus', () => {
    expect(resolveAudioOnlyContainerFormat('opus')).toBe('webm');
  });

  it('returns mp4 for aac', () => {
    expect(resolveAudioOnlyContainerFormat('aac')).toBe('mp4');
  });
});

describe('resolveAudioOnlyFileExtension', () => {
  it('returns opus for opus codec', () => {
    expect(resolveAudioOnlyFileExtension('opus')).toBe('opus');
  });

  it('returns m4a for aac codec', () => {
    expect(resolveAudioOnlyFileExtension('aac')).toBe('m4a');
  });
});

describe('clampPositiveNumber', () => {
  it('returns fallback for non-positive values', () => {
    expect(clampPositiveNumber(-5, 10)).toBe(10);
    expect(clampPositiveNumber(0, 10)).toBe(10);
    expect(clampPositiveNumber(NaN, 10)).toBe(10);
  });

  it('returns the value if positive', () => {
    expect(clampPositiveNumber(5, 10)).toBe(5);
  });
});

describe('isAbortError', () => {
  it('returns true for AbortError', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isAbortError(new Error('test'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('removeCreatedFile', () => {
  it('removes the file on first attempt', async () => {
    const dirHandle = {
      removeEntry: vi.fn().mockResolvedValue(undefined),
    } as unknown as FileSystemDirectoryHandle;

    await removeCreatedFile({ dirHandle, fileName: 'test.mp4' });

    expect(dirHandle.removeEntry).toHaveBeenCalledTimes(1);
    expect(dirHandle.removeEntry).toHaveBeenCalledWith('test.mp4');
  });

  it('retries up to 5 times on failure', async () => {
    const dirHandle = {
      removeEntry: vi.fn().mockRejectedValue(new Error('busy')),
    } as unknown as FileSystemDirectoryHandle;

    await removeCreatedFile({ dirHandle, fileName: 'test.mp4' });

    expect(dirHandle.removeEntry).toHaveBeenCalledTimes(5);
  });

  it('succeeds on a later retry', async () => {
    let calls = 0;
    const dirHandle = {
      removeEntry: vi.fn().mockImplementation(() => {
        calls++;
        if (calls < 3) return Promise.reject(new Error('busy'));
        return Promise.resolve(undefined);
      }),
    } as unknown as FileSystemDirectoryHandle;

    await removeCreatedFile({ dirHandle, fileName: 'test.mp4' });

    expect(dirHandle.removeEntry).toHaveBeenCalledTimes(3);
  });

  it('returns early when dirHandle is null', async () => {
    await removeCreatedFile({ dirHandle: null, fileName: 'test.mp4' });
    // No error should be thrown
  });

  it('returns early when fileName is null', async () => {
    const dirHandle = {
      removeEntry: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    await removeCreatedFile({ dirHandle, fileName: null });
    expect(dirHandle.removeEntry).not.toHaveBeenCalled();
  });
});

describe('resolveUniqueFileName', () => {
  it('returns original name when file does not exist', async () => {
    const result = await resolveUniqueFileName({
      existingNames: ['other.mp4'],
      filePath: '/dir/test.mp4',
      fileName: 'test.mp4',
    });
    expect(result).toEqual({ filePath: '/dir/test.mp4', fileName: 'test.mp4' });
  });

  it('increments name when file exists', async () => {
    const result = await resolveUniqueFileName({
      existingNames: ['test.mp4', 'test_2.mp4'],
      filePath: '/dir/test.mp4',
      fileName: 'test.mp4',
    });
    expect(result).toEqual({ filePath: '/dir/test_3.mp4', fileName: 'test_3.mp4' });
  });

  it('handles files without extension', async () => {
    const result = await resolveUniqueFileName({
      existingNames: ['test'],
      filePath: '/dir/test',
      fileName: 'test',
    });
    expect(result).toEqual({ filePath: '/dir/test_1', fileName: 'test_1' });
  });

  it('does not fill gaps', async () => {
    const result = await resolveUniqueFileName({
      existingNames: ['test.mp4', 'test_3.mp4'],
      filePath: '/dir/test.mp4',
      fileName: 'test.mp4',
    });
    expect(result).toEqual({ filePath: '/dir/test_4.mp4', fileName: 'test_4.mp4' });
  });
});
