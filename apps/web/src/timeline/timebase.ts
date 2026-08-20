import type { TimelineTimebase } from './types';
import {
  DEFAULT_FRAME_RATE,
  frameRateToNumber,
  sanitizeFrameRate,
  type FrameRate,
} from '~/utils/time/ticks';

export function getTimelineFrameRate(
  timebase: TimelineTimebase | null | undefined,
  fallback: FrameRate = DEFAULT_FRAME_RATE,
): FrameRate {
  return sanitizeFrameRate(timebase, fallback);
}

export function getTimelineFps(
  timebase: TimelineTimebase | null | undefined,
  fallback: FrameRate = DEFAULT_FRAME_RATE,
): number {
  return frameRateToNumber(getTimelineFrameRate(timebase, fallback));
}

export function createTimelineTimebase(frameRate: FrameRate): TimelineTimebase {
  const normalized = sanitizeFrameRate(frameRate, DEFAULT_FRAME_RATE);
  return { num: normalized.num, den: normalized.den };
}

export function createTimelineTimebaseFromFps(fps: number): TimelineTimebase {
  return createTimelineTimebase(sanitizeFrameRate(fps, DEFAULT_FRAME_RATE));
}
