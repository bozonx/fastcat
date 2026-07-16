/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  mergeFadeInTicks,
  mergeFadeOutTicks,
  isProbablyUrlLike,
  getDirname,
  joinPaths,
  normalizeProjectPath,
  resolveNestedMediaPath,
  composeNestedTransform,
} from '~/utils/video-editor/worker-clip-utils';
import { VIDEO_DIR_NAME } from '~/utils/constants';

describe('worker-clip-utils', () => {
  describe('composeNestedTransform', () => {
    it('returns the child transform when the parent is identity', () => {
      const child = { scale: { x: 2, y: 2 }, position: { x: 10, y: 20 }, rotationDeg: 30 };
      expect(composeNestedTransform({ parent: undefined, child })).toEqual(child);
    });

    it('returns the parent transform when the child is identity', () => {
      const parent = { scale: { x: 0.5, y: 0.5 }, position: { x: 100, y: 0 }, rotationDeg: 0 };
      const result = composeNestedTransform({ parent, child: undefined });
      expect(result?.scale).toEqual({ x: 0.5, y: 0.5 });
      expect(result?.position).toEqual({ x: 100, y: 0 });
      expect(result?.rotationDeg).toBe(0);
    });

    it('multiplies scale and adds rotation', () => {
      const result = composeNestedTransform({
        parent: { scale: { x: 2, y: 3 }, rotationDeg: 10 },
        child: { scale: { x: 1.5, y: 0.5 }, rotationDeg: 25 },
      });
      expect(result?.scale).toEqual({ x: 3, y: 1.5 });
      expect(result?.rotationDeg).toBe(35);
    });

    it('scales the child position by the parent scale (no parent rotation)', () => {
      const result = composeNestedTransform({
        parent: { scale: { x: 2, y: 2 }, position: { x: 100, y: 50 } },
        child: { position: { x: 10, y: 20 } },
      });
      // pos = scaleParent ⊙ childPos + parentPos
      expect(result?.position?.x).toBeCloseTo(2 * 10 + 100, 6);
      expect(result?.position?.y).toBeCloseTo(2 * 20 + 50, 6);
    });

    it('rotates the child position by the parent rotation', () => {
      const result = composeNestedTransform({
        parent: { rotationDeg: 90, position: { x: 0, y: 0 } },
        child: { position: { x: 10, y: 0 } },
      });
      // 90° rotation of (10, 0) → (0, 10)
      expect(result?.position?.x).toBeCloseTo(0, 6);
      expect(result?.position?.y).toBeCloseTo(10, 6);
    });

    it('folds the parent source orientation into the rotation', () => {
      const result = composeNestedTransform({
        parent: undefined,
        parentOrientation: '90',
        child: { rotationDeg: 5 },
      });
      expect(result?.rotationDeg).toBe(95);
    });

    it('preserves the child anchor and crop, drops the parent crop', () => {
      const result = composeNestedTransform({
        parent: { scale: { x: 2, y: 2 }, crop: { left: 10 } },
        child: { anchor: { preset: 'topLeft' }, crop: { top: 5 } },
      });
      expect(result?.anchor).toEqual({ preset: 'topLeft' });
      expect(result?.crop).toEqual({ top: 5 });
    });
  });

  describe('mergeFadeInTicks', () => {
    it('returns child fade if no parent fade', () => {
      expect(
        mergeFadeInTicks({
          childFadeInTicks: 100,
          parentFadeInTicks: 0,
          parentLocalStartTicks: 0,
        }),
      ).toBe(100);
    });

    it('returns parent remaining fade if larger', () => {
      expect(
        mergeFadeInTicks({
          childFadeInTicks: 100,
          parentFadeInTicks: 500,
          parentLocalStartTicks: 200,
        }),
      ).toBe(300); // 500 - 200
    });

    it('returns child fade if child fade is larger than remaining parent fade', () => {
      expect(
        mergeFadeInTicks({
          childFadeInTicks: 400,
          parentFadeInTicks: 500,
          parentLocalStartTicks: 200,
        }),
      ).toBe(400); // max(400, 300)
    });
  });

  describe('mergeFadeOutTicks', () => {
    it('returns child fade if no parent fade', () => {
      expect(
        mergeFadeOutTicks({
          childFadeOutTicks: 100,
          parentFadeOutTicks: 0,
          parentLocalEndTicks: 1000,
          parentDurationTicks: 1000,
        }),
      ).toBe(100);
    });

    it('computes correctly if parent ends before child ends', () => {
      expect(
        mergeFadeOutTicks({
          childFadeOutTicks: 100,
          parentFadeOutTicks: 500,
          parentLocalEndTicks: 1000,
          parentDurationTicks: 1000,
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

    it('normalizeProjectPath', () => {
      expect(normalizeProjectPath(' timelines/./sub/../root.otio ')).toBe('timelines/root.otio');
      expect(normalizeProjectPath('http://example.com/a/../b.mp4')).toBe(
        'http://example.com/a/../b.mp4',
      );
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

      expect(
        resolveNestedMediaPath({
          nestedTimelinePath: 'timelines/sub/a.otio',
          mediaPath: '../root.otio',
        }),
      ).toBe('timelines/root.otio');
    });
  });
});
