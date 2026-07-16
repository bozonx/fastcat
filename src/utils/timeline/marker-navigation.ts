import type { TimelineMarker } from '~/timeline/types';
import { quantizeTimeUsToFrames } from '~/timeline/commands/utils';

export interface MarkerNavigationResult {
  timeTicks: number;
}

/**
 * Collect unique boundary points from markers, quantizing them to frame
 * boundaries so they align with the playhead after setCurrentTimeTicks.
 */
function getUniqueMarkerPoints(markers: TimelineMarker[], fps: number): number[] {
  const rawPoints = new Set<number>();
  for (const m of markers) {
    rawPoints.add(m.timeTicks);
    if (m.durationTicks) {
      rawPoints.add(m.timeTicks + m.durationTicks);
    }
  }
  const points = Array.from(rawPoints);
  const quantized = points.map((p) => quantizeTimeUsToFrames(p, fps, 'round'));
  const uniqueSet = new Set(quantized);
  return Array.from(uniqueSet).sort((a, b) => a - b);
}

/**
 * Find the next marker boundary strictly after currentTime.
 * Returns undefined if none exists.
 */
export function findNextMarkerTime(
  markers: TimelineMarker[],
  currentTime: number,
  fps: number,
): number | undefined {
  const points = getUniqueMarkerPoints(markers, fps);
  const next = points.find((p) => p > currentTime);
  return next;
}

/**
 * Find the previous marker boundary strictly before currentTime.
 * Returns undefined if none exists.
 */
export function findPreviousMarkerTime(
  markers: TimelineMarker[],
  currentTime: number,
  fps: number,
): number | undefined {
  const points = getUniqueMarkerPoints(markers, fps);
  // sort descending for reverse search
  const sortedDesc = points.sort((a, b) => b - a);
  const prev = sortedDesc.find((p) => p < currentTime);
  return prev;
}
