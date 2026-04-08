import { describe, it, expect } from 'vitest';
import { isMoveAllowed, isCopyAllowed, MAX_COPY_DEPTH } from '~/file-manager/core/rules';

describe('file-manager/core/rules', () => {
  describe('isMoveAllowed', () => {
    it('should prevent moving directory into itself', () => {
      expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: 'a' })).toBe(false);
    });

    it('should prevent moving directory into its descendant', () => {
      expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: 'a/b' })).toBe(false);
      expect(isMoveAllowed({ sourcePath: 'a/b', targetDirPath: 'a/b/c' })).toBe(false);
    });

    it('should allow moving into root', () => {
      expect(isMoveAllowed({ sourcePath: 'a/b', targetDirPath: '' })).toBe(true);
    });

    it('should allow moving out of descendant', () => {
      expect(isMoveAllowed({ sourcePath: 'a/b', targetDirPath: 'a' })).toBe(true);
      expect(isMoveAllowed({ sourcePath: 'a/b/c', targetDirPath: 'a' })).toBe(true);
    });

    it('should allow moving between unrelated paths', () => {
      expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: 'b' })).toBe(true);
      expect(isMoveAllowed({ sourcePath: 'a/b', targetDirPath: 'c/d' })).toBe(true);
    });

    it('should handle empty paths', () => {
      expect(isMoveAllowed({ sourcePath: '', targetDirPath: 'a' })).toBe(true);
      expect(isMoveAllowed({ sourcePath: 'a', targetDirPath: '' })).toBe(true);
      expect(isMoveAllowed({ sourcePath: '', targetDirPath: '' })).toBe(true);
    });
  });

  describe('isCopyAllowed', () => {
    it('should prevent copying directory into itself', () => {
      expect(isCopyAllowed({ sourcePath: 'a', targetDirPath: 'a' })).toBe(false);
    });

    it('should prevent copying directory into its descendant', () => {
      expect(isCopyAllowed({ sourcePath: 'a', targetDirPath: 'a/b' })).toBe(false);
      expect(isCopyAllowed({ sourcePath: 'a/b', targetDirPath: 'a/b/c' })).toBe(false);
    });

    it('should allow copying into root', () => {
      expect(isCopyAllowed({ sourcePath: 'a/b', targetDirPath: '' })).toBe(true);
    });

    it('should allow copying out of descendant', () => {
      expect(isCopyAllowed({ sourcePath: 'a/b', targetDirPath: 'a' })).toBe(true);
      expect(isCopyAllowed({ sourcePath: 'a/b/c', targetDirPath: 'a' })).toBe(true);
    });

    it('should allow copying between unrelated paths', () => {
      expect(isCopyAllowed({ sourcePath: 'a', targetDirPath: 'b' })).toBe(true);
      expect(isCopyAllowed({ sourcePath: 'a/b', targetDirPath: 'c/d' })).toBe(true);
    });

    it('should handle empty paths', () => {
      expect(isCopyAllowed({ sourcePath: '', targetDirPath: 'a' })).toBe(true);
      expect(isCopyAllowed({ sourcePath: 'a', targetDirPath: '' })).toBe(true);
      expect(isCopyAllowed({ sourcePath: '', targetDirPath: '' })).toBe(true);
    });

    it('should match isMoveAllowed behavior', () => {
      const cases = [
        { sourcePath: 'a', targetDirPath: 'a' },
        { sourcePath: 'a', targetDirPath: 'a/b' },
        { sourcePath: 'a/b', targetDirPath: 'a' },
        { sourcePath: 'a/b', targetDirPath: 'c/d' },
        { sourcePath: '', targetDirPath: 'a' },
      ];
      for (const c of cases) {
        expect(isCopyAllowed(c)).toBe(isMoveAllowed(c));
      }
    });
  });

  describe('MAX_COPY_DEPTH', () => {
    it('should be a positive integer', () => {
      expect(Number.isInteger(MAX_COPY_DEPTH)).toBe(true);
      expect(MAX_COPY_DEPTH).toBeGreaterThan(0);
    });
  });
});
