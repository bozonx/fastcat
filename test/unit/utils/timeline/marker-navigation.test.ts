import { describe, it, expect } from 'vitest';
import { findNextMarkerTime, findPreviousMarkerTime } from '~/utils/timeline/marker-navigation';
import type { TimelineMarker } from '~/timeline/types';
import { timelineTicks } from '../../utils/timeline-time';

const FPS = 30;

function makeMarker(timeTicks: number, durationTicks?: number): TimelineMarker {
  return {
    id: `m_${timeTicks}`,
    timeTicks,
    durationTicks,
    text: '',
    color: '#eab308',
  };
}

describe('findNextMarkerTime', () => {
  it('returns undefined when no markers exist', () => {
    expect(findNextMarkerTime([], 0, FPS)).toBeUndefined();
  });

  it('jumps from start to a point marker', () => {
    const markers = [makeMarker(timelineTicks(1_000_000))];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(timelineTicks(1_000_000));
  });

  it('jumps over a zone start to its end when playhead is before the zone', () => {
    const markers = [makeMarker(timelineTicks(500_000), timelineTicks(500_000))];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(timelineTicks(500_000));
  });

  it('jumps from inside a zone to its end', () => {
    const markers = [makeMarker(0, timelineTicks(1_000_000))];
    expect(findNextMarkerTime(markers, timelineTicks(100_000), FPS)).toBe(timelineTicks(1_000_000));
  });

  it('jumps from zone end to next marker', () => {
    const markers = [makeMarker(0, timelineTicks(1_000_000)), makeMarker(timelineTicks(2_000_000))];
    expect(findNextMarkerTime(markers, timelineTicks(1_000_000), FPS)).toBe(
      timelineTicks(2_000_000),
    );
  });

  it('skips duplicate boundary points (zone end == next start)', () => {
    const markers = [makeMarker(0, timelineTicks(1_000_000)), makeMarker(timelineTicks(1_000_000))];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(timelineTicks(1_000_000));
    // after landing on 1_000_000, next jump should find nothing (single unique point)
    expect(findNextMarkerTime(markers, timelineTicks(1_000_000), FPS)).toBeUndefined();
  });

  it('handles multiple markers with same start time', () => {
    const markers = [makeMarker(0), makeMarker(0), makeMarker(timelineTicks(1_000_000))];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(timelineTicks(1_000_000));
  });

  it('does not get stuck when currentTime is slightly off due to frame quantization', () => {
    const markers = [makeMarker(timelineTicks(1_000_000)), makeMarker(timelineTicks(2_000_000))];
    // If currentTime quantizes to the 1s marker, next should still be 2s.
    expect(findNextMarkerTime(markers, timelineTicks(1_000_000), FPS)).toBe(
      timelineTicks(2_000_000),
    );
  });

  it('handles non-30fps quantization correctly', () => {
    // 25 fps => frame = 1/25s. 1_000_000us -> exactly 25 frames.
    const markers = [makeMarker(timelineTicks(1_000_000)), makeMarker(timelineTicks(2_000_000))];
    expect(findNextMarkerTime(markers, timelineTicks(1_000_000), 25)).toBe(
      timelineTicks(2_000_000),
    );
  });
});

describe('findPreviousMarkerTime', () => {
  it('returns undefined when no markers exist', () => {
    expect(findPreviousMarkerTime([], 0, FPS)).toBeUndefined();
  });

  it('jumps back to a point marker', () => {
    const markers = [makeMarker(timelineTicks(1_000_000))];
    expect(findPreviousMarkerTime(markers, timelineTicks(2_000_000), FPS)).toBe(
      timelineTicks(1_000_000),
    );
  });

  it('jumps from after a zone to its end', () => {
    const markers = [makeMarker(0, timelineTicks(1_000_000))];
    expect(findPreviousMarkerTime(markers, timelineTicks(2_000_000), FPS)).toBe(
      timelineTicks(1_000_000),
    );
  });

  it('jumps from inside a zone back to its start', () => {
    const markers = [makeMarker(0, timelineTicks(1_000_000))];
    expect(findPreviousMarkerTime(markers, timelineTicks(500_000), FPS)).toBe(0);
  });

  it('jumps from zone end to zone start', () => {
    const markers = [makeMarker(0, timelineTicks(1_000_000))];
    expect(findPreviousMarkerTime(markers, timelineTicks(1_000_000), FPS)).toBe(0);
  });

  it('skips duplicate boundary points (zone end == next start)', () => {
    const markers = [makeMarker(0, timelineTicks(1_000_000)), makeMarker(timelineTicks(1_000_000))];
    // from after 1s, previous should be the 1s point (the closest previous unique point)
    expect(findPreviousMarkerTime(markers, timelineTicks(2_000_000), FPS)).toBe(
      timelineTicks(1_000_000),
    );
    // from 1s, previous should be 0
    expect(findPreviousMarkerTime(markers, timelineTicks(1_000_000), FPS)).toBe(0);
  });

  it('handles multiple markers with same start time', () => {
    const markers = [makeMarker(0), makeMarker(0), makeMarker(timelineTicks(1_000_000))];
    expect(findPreviousMarkerTime(markers, timelineTicks(1_000_000), FPS)).toBe(0);
  });

  it('does not get stuck when currentTime is slightly off due to frame quantization', () => {
    const markers = [makeMarker(timelineTicks(1_000_000)), makeMarker(timelineTicks(2_000_000))];
    expect(findPreviousMarkerTime(markers, timelineTicks(2_000_000), FPS)).toBe(
      timelineTicks(1_000_000),
    );
  });
});
