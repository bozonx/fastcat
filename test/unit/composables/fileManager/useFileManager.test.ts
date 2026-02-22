import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFileManager } from '~/composables/fileManager/useFileManager';

describe('useFileManager', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('should initialize with default state', () => {
    const { rootEntries, isLoading, error } = useFileManager();

    expect(rootEntries.value).toEqual([]);
    expect(isLoading.value).toBe(false);
    expect(error.value).toBeNull();
    // isApiSupported depends on the environment, we can't strict check it easily without mocking
  });

  it('getFileIcon should return correct icon for different extensions', () => {
    const { getFileIcon } = useFileManager();

    expect(
      getFileIcon({
        name: 'folder',
        kind: 'directory',
        handle: {} as unknown as FileSystemDirectoryHandle,
      }),
    ).toBe('i-heroicons-folder');
    expect(
      getFileIcon({
        name: 'video.mp4',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-film');
    expect(
      getFileIcon({
        name: 'audio.mp3',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-musical-note');
    expect(
      getFileIcon({
        name: 'image.png',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-photo');
    expect(
      getFileIcon({
        name: 'project.otio',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-document-text');
    expect(
      getFileIcon({
        name: 'unknown.txt',
        kind: 'file',
        handle: {} as unknown as FileSystemFileHandle,
      }),
    ).toBe('i-heroicons-document');
  });
});
