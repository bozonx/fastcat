/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useUploadProgress } from '~/composables/useUploadProgress';

describe('useUploadProgress', () => {
  it('initializes with default values', () => {
    const { isActive, progress, fileName, phase } = useUploadProgress();
    expect(isActive.value).toBe(false);
    expect(progress.value).toBe(0);
    expect(fileName.value).toBe('');
    expect(phase.value).toBe('');
  });

  it('begin sets active state and returns abort signal', () => {
    const { isActive, progress, phase, begin } = useUploadProgress();
    const signal = begin('uploading', false);
    expect(isActive.value).toBe(true);
    expect(progress.value).toBe(0);
    expect(phase.value).toBe('uploading');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('begin with useBackground=true sets isActive to false', () => {
    const { isActive, begin } = useUploadProgress();
    begin('background', true);
    expect(isActive.value).toBe(false);
  });

  it('end resets isActive', () => {
    const { isActive, begin, end } = useUploadProgress();
    begin('uploading', false);
    end();
    expect(isActive.value).toBe(false);
  });

  it('cancel aborts and resets isActive', () => {
    const { isActive, begin, cancel } = useUploadProgress();
    const signal = begin('uploading', false);
    cancel();
    expect(isActive.value).toBe(false);
    expect(signal.aborted).toBe(true);
  });

  it('onProgress updates progress with byte ratio', () => {
    const { progress, fileName, onProgress, begin } = useUploadProgress();
    begin('uploading', false);
    onProgress(
      {
        currentFileIndex: 0,
        totalFiles: 3,
        fileName: 'test.mp4',
        loadedBytes: 50,
        totalBytes: 100,
      },
      0,
    );
    expect(progress.value).toBe(0.5);
    expect(fileName.value).toBe('test.mp4');
  });

  it('onProgress falls back to file index ratio when totalBytes is 0', () => {
    const { progress, onProgress, begin } = useUploadProgress();
    begin('uploading', false);
    onProgress(
      {
        currentFileIndex: 2,
        totalFiles: 4,
        fileName: 'test.mp4',
        loadedBytes: 0,
        totalBytes: 0,
      },
      0,
    );
    expect(progress.value).toBe(0.5);
  });

  it('onProgress uses fallbackTotalBytes when totalBytes is undefined', () => {
    const { progress, onProgress, begin } = useUploadProgress();
    begin('uploading', false);
    onProgress(
      {
        currentFileIndex: 0,
        totalFiles: 1,
        fileName: 'test.mp4',
        loadedBytes: 25,
      },
      100,
    );
    expect(progress.value).toBe(0.25);
  });
});
