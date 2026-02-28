import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useFileManager, isMoveAllowed } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';

describe('useFileManager', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('should initialize with default state', () => {
    const { rootEntries, isLoading, error } = useFileManager();

    expect(rootEntries.value).toEqual([]);
    expect(isLoading.value).toBe(false);
    expect(error.value).toBeNull();
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

  it('isMoveAllowed should prevent moving directory into itself or descendant', () => {
    expect(isMoveAllowed({ sourcePath: '_video', targetDirPath: '_video' })).toBe(false);
    expect(isMoveAllowed({ sourcePath: '_video', targetDirPath: '_video/sub' })).toBe(false);
    expect(isMoveAllowed({ sourcePath: '_video/sub', targetDirPath: '_video' })).toBe(true);
  });

  it('isMoveAllowed should allow moving into root', () => {
    expect(isMoveAllowed({ sourcePath: 'a/b', targetDirPath: '' })).toBe(true);
  });

  it('isMoveAllowed should handle edge cases', () => {
    expect(isMoveAllowed({ sourcePath: '', targetDirPath: 'a' })).toBe(true);
    expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: '' })).toBe(true);
    expect(isMoveAllowed({ sourcePath: 'a/b/c', targetDirPath: 'a' })).toBe(true);
    expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: 'a/b' })).toBe(false);
  });

  it('should have sortMode with default value', () => {
    const { sortMode } = useFileManager();
    expect(sortMode.value).toBe('name');
  });

  it('FsEntry type should match expected structure', () => {
    const entry: FsEntry = {
      name: 'test',
      kind: 'file',
      handle: {} as unknown as FileSystemFileHandle,
      path: 'test/path',
      lastModified: Date.now(),
    };

    expect(entry.name).toBe('test');
    expect(entry.kind).toBe('file');
    expect(entry.path).toBe('test/path');
  });
});
