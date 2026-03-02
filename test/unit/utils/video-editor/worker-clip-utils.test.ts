import { describe, it, expect } from 'vitest';
import {
  mergeFadeInUs,
  mergeFadeOutUs,
  isProbablyUrlLike,
  getDirname,
  joinPaths,
  resolveNestedMediaPath,
} from '~/utils/video-editor/worker-clip-utils';
import { VIDEO_DIR_NAME } from '~/utils/constants';

describe('worker-clip-utils', () => {
  describe('mergeFadeInUs', () => {
    it('returns child fade if no parent fade', () => {
      expect(
        mergeFadeInUs({
          childFadeInUs: 100,
          parentFadeInUs: 0,
          parentLocalStartUs: 0,
        }),
      ).toBe(100);
    });

    it('returns parent remaining fade if larger', () => {
      expect(
        mergeFadeInUs({
          childFadeInUs: 100,
          parentFadeInUs: 500,
          parentLocalStartUs: 200,
        }),
      ).toBe(300); // 500 - 200
    });

    it('returns child fade if child fade is larger than remaining parent fade', () => {
      expect(
        mergeFadeInUs({
          childFadeInUs: 400,
          parentFadeInUs: 500,
          parentLocalStartUs: 200,
        }),
      ).toBe(400); // max(400, 300)
    });
  });

  describe('mergeFadeOutUs', () => {
    it('returns child fade if no parent fade', () => {
      expect(
        mergeFadeOutUs({
          childFadeOutUs: 100,
          parentFadeOutUs: 0,
          parentLocalEndUs: 1000,
          parentDurationUs: 1000,
        }),
      ).toBe(100);
    });

    it('computes correctly if parent ends before child ends', () => {
      expect(
        mergeFadeOutUs({
          childFadeOutUs: 100,
          parentFadeOutUs: 500,
          parentLocalEndUs: 1000,
          parentDurationUs: 1000,
        }),
      ).toBe(500);
    });
  });

  describe('path helpers', () => {
    it('isProbablyUrlLike', () => {
      expect(isProbablyUrlLike('http://example.com')).toBe(true);
      expect(isProbablyUrlLike('file:///C:/test')).toBe(true);
      expect(isProbablyUrlLike('/absolute/path')).toBe(false);
      expect(isProbablyUrlLike('relative/path.mp4')).toBe(false);
    });

    it('getDirname', () => {
      expect(getDirname('folder/file.mp4')).toBe('folder');
      expect(getDirname('/folder/file.mp4')).toBe('/folder');
      expect(getDirname('file.mp4')).toBe('');
      expect(getDirname('folder\\file.mp4')).toBe('folder');
    });

    it('joinPaths', () => {
      expect(joinPaths('folder', 'file.mp4')).toBe('folder/file.mp4');
      expect(joinPaths('folder/', '/file.mp4')).toBe('folder/file.mp4');
      expect(joinPaths('', 'file.mp4')).toBe('file.mp4');
      expect(joinPaths('folder', '')).toBe('folder');
    });

    it('resolveNestedMediaPath', () => {
      expect(
        resolveNestedMediaPath({
          nestedTimelinePath: 'timelines/sub/my.otio',
          mediaPath: 'clip.mp4',
        }),
      ).toBe('timelines/sub/clip.mp4');

      expect(
        resolveNestedMediaPath({
          nestedTimelinePath: 'timelines/my.otio',
          mediaPath: '/absolute/clip.mp4',
        }),
      ).toBe('/absolute/clip.mp4');

      expect(
        resolveNestedMediaPath({
          nestedTimelinePath: 'timelines/my.otio',
          mediaPath: `${VIDEO_DIR_NAME}/clip.mp4`,
        }),
      ).toBe(`${VIDEO_DIR_NAME}/clip.mp4`);

      expect(
        resolveNestedMediaPath({
          nestedTimelinePath: 'my.otio',
          mediaPath: 'clip.mp4',
        }),
      ).toBe('clip.mp4');
    });
  });
});
