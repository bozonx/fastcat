import { describe, it, expect } from 'vitest';
import {
  PLAYBACK_SPEED_VALUES,
  WHEEL_SPEED_VALUES,
  formatSpeedLabel,
  stepPlaybackSpeed,
} from '~/utils/playbackSpeeds';

describe('playbackSpeeds', () => {
  describe('PLAYBACK_SPEED_VALUES / WHEEL_SPEED_VALUES', () => {
    it('exposes the canonical positive grid ascending', () => {
      expect([...PLAYBACK_SPEED_VALUES]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 5]);
    });

    it('builds the signed wheel grid without zero, most-negative first', () => {
      expect([...WHEEL_SPEED_VALUES]).toEqual([
        -5, -3, -2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 5,
      ]);
    });

    it('never contains zero', () => {
      expect(WHEEL_SPEED_VALUES).not.toContain(0);
    });

    it('keeps the grid sorted ascending', () => {
      const sorted = [...WHEEL_SPEED_VALUES].sort((a, b) => a - b);
      expect([...WHEEL_SPEED_VALUES]).toEqual(sorted);
    });
  });

  describe('formatSpeedLabel', () => {
    it('labels positive speeds with an "x" suffix', () => {
      expect(formatSpeedLabel(1)).toBe('1x');
      expect(formatSpeedLabel(1.5)).toBe('1.5x');
      expect(formatSpeedLabel(0.5)).toBe('0.5x');
    });

    it('prefixes negative speeds with "-"', () => {
      expect(formatSpeedLabel(-1)).toBe('-1x');
      expect(formatSpeedLabel(-2)).toBe('-2x');
      expect(formatSpeedLabel(-0.5)).toBe('-0.5x');
    });
  });

  describe('stepPlaybackSpeed', () => {
    it('walks one step up through the forward grid', () => {
      expect(stepPlaybackSpeed(1, 'up')).toBe(1.25);
      expect(stepPlaybackSpeed(1.25, 'up')).toBe(1.5);
      expect(stepPlaybackSpeed(1.5, 'up')).toBe(1.75);
      expect(stepPlaybackSpeed(2, 'up')).toBe(3);
    });

    it('clamps at the 5x ceiling on up', () => {
      expect(stepPlaybackSpeed(5, 'up')).toBe(5);
    });

    it('walks one step down and crosses into reverse through the gap', () => {
      expect(stepPlaybackSpeed(1, 'down')).toBe(0.75);
      expect(stepPlaybackSpeed(0.75, 'down')).toBe(0.5);
      // 0.5 → -0.5 (zero is skipped)
      expect(stepPlaybackSpeed(0.5, 'down')).toBe(-0.5);
      expect(stepPlaybackSpeed(-0.5, 'down')).toBe(-0.75);
      expect(stepPlaybackSpeed(-1, 'down')).toBe(-1.25);
    });

    it('clamps at the -5x floor on down', () => {
      expect(stepPlaybackSpeed(-5, 'down')).toBe(-5);
    });

    it('walks up from negative reverse speeds towards forward', () => {
      expect(stepPlaybackSpeed(-0.5, 'up')).toBe(0.5);
      expect(stepPlaybackSpeed(-1, 'up')).toBe(-0.75);
      expect(stepPlaybackSpeed(-3, 'up')).toBe(-2);
    });

    it('snaps an off-grid value up to the next grid step', () => {
      // 1.3 is off-grid; up -> nearest above (1.5)
      expect(stepPlaybackSpeed(1.3, 'up')).toBe(1.5);
      // 0.8 is off-grid; up -> nearest above (1)
      expect(stepPlaybackSpeed(0.8, 'up')).toBe(1);
    });

    it('snaps an off-grid value down to the previous grid step', () => {
      // 1.3 is off-grid; down -> nearest below (1.25)
      expect(stepPlaybackSpeed(1.3, 'down')).toBe(1.25);
      // 0.3 is off-grid; down -> nearest below (0.5)? No — 0.5 > 0.3, so -0.5
      expect(stepPlaybackSpeed(0.3, 'down')).toBe(-0.5);
    });

    it('treats a value above the grid as the ceiling', () => {
      expect(stepPlaybackSpeed(8, 'up')).toBe(5);
    });

    it('treats a value below the grid as the floor', () => {
      expect(stepPlaybackSpeed(-8, 'down')).toBe(-5);
    });
  });
});
