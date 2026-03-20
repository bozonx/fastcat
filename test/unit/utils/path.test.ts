import { describe, it, expect } from 'vitest';
import { dirname } from '~/utils/path';

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
});
