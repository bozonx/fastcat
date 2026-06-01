import { describe, expect, it } from 'vitest';
import { joinTauriFsPath } from '~/utils/tauri-local-path';

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
