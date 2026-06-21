/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { isImagePath, isImageMimeType, extOf } from '~/utils/media-ext';

describe('media-ext', () => {
  describe('extOf', () => {
    it('returns lowercase extension', () => {
      expect(extOf('file.PNG')).toBe('png');
      expect(extOf('file.jpg')).toBe('jpg');
      expect(extOf('file')).toBe('');
    });
  });

  describe('isImagePath', () => {
    it('returns true for image extensions', () => {
      expect(isImagePath('file.png')).toBe(true);
      expect(isImagePath('file.jpg')).toBe(true);
      expect(isImagePath('file.jpeg')).toBe(true);
      expect(isImagePath('file.webp')).toBe(true);
      expect(isImagePath('file.gif')).toBe(true);
      expect(isImagePath('file.svg')).toBe(true);
    });

    it('returns false for non-image extensions', () => {
      expect(isImagePath('file.mp4')).toBe(false);
      expect(isImagePath('file')).toBe(false);
    });
  });

  describe('isImageMimeType', () => {
    it('returns true for image mime types', () => {
      expect(isImageMimeType('image/png')).toBe(true);
      expect(isImageMimeType('image/jpeg')).toBe(true);
    });

    it('returns false for non-image mime types', () => {
      expect(isImageMimeType('video/mp4')).toBe(false);
    });
  });
});
