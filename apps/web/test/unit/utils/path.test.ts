/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { dirname, joinTauriFsPath, normalizeMediaCachePath } from '~/utils/path';

describe('path', () => {
  describe('dirname', () => {
    it('returns the directory part of a path', () => {
      expect(dirname('/path/to/file.txt')).toBe('/path/to');
      expect(dirname('path/to/file.txt')).toBe('path/to');
      expect(dirname('/file.txt')).toBe('');
      expect(dirname('file.txt')).toBe('');
      expect(dirname('')).toBe('');
      expect(dirname('/')).toBe('');
    });
  });

  describe('joinTauriFsPath', () => {
    it('joins POSIX absolute paths without duplicate separators', () => {
      expect(joinTauriFsPath('/Users/me/FastCat/', '/project', 'file.otio')).toBe(
        '/Users/me/FastCat/project/file.otio',
      );
    });

    it('joins Windows drive paths using Tauri-compatible separators', () => {
      expect(joinTauriFsPath('C:\\Users\\me\\Documents', 'FastCat', 'project.otio')).toBe(
        'C:/Users/me/Documents/FastCat/project.otio',
      );
    });

    it('keeps root paths valid', () => {
      expect(joinTauriFsPath('/', 'tmp', 'fastcat')).toBe('/tmp/fastcat');
    });
  });

  describe('normalizeMediaCachePath', () => {
    it('normalizes project-relative separators', () => {
      expect(normalizeMediaCachePath(' media\\clips\\video.mp4 ')).toBe('media/clips/video.mp4');
    });

    it('preserves the external prefix', () => {
      expect(normalizeMediaCachePath('external:media\\clips\\video.mp4')).toBe(
        'external:media/clips/video.mp4',
      );
    });
  });
});
