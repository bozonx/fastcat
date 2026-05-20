import { describe, it, expect } from 'vitest';
import { findNextMarkerTime, findPreviousMarkerTime } from '~/utils/timeline/marker-navigation';
import type { TimelineMarker } from '~/timeline/types';

const FPS = 30;

function makeMarker(timeUs: number, durationUs?: number): TimelineMarker {
  return {
    id: `m_${timeUs}`,
    timeUs,
    durationUs,
    text: '',
    color: '#eab308',
  };
}

describe('findNextMarkerTime', () => {
  it('returns undefined when no markers exist', () => {
    expect(findNextMarkerTime([], 0, FPS)).toBeUndefined();
  });

  it('jumps from start to a point marker', () => {
    const markers = [makeMarker(1_000_000)];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(1_000_000);
  });

  it('jumps over a zone start to its end when playhead is before the zone', () => {
    const markers = [makeMarker(500_000, 500_000)];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(500_000);
  });

  it('jumps from inside a zone to its end', () => {
    const markers = [makeMarker(0, 1_000_000)];
    expect(findNextMarkerTime(markers, 100_000, FPS)).toBe(1_000_000);
  });

  it('jumps from zone end to next marker', () => {
    const markers = [makeMarker(0, 1_000_000), makeMarker(2_000_000)];
    expect(findNextMarkerTime(markers, 1_000_000, FPS)).toBe(2_000_000);
  });

  it('skips duplicate boundary points (zone end == next start)', () => {
    const markers = [makeMarker(0, 1_000_000), makeMarker(1_000_000)];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(1_000_000);
    // after landing on 1_000_000, next jump should find nothing (single unique point)
    expect(findNextMarkerTime(markers, 1_000_000, FPS)).toBeUndefined();
  });

  it('handles multiple markers with same start time', () => {
    const markers = [makeMarker(0), makeMarker(0), makeMarker(1_000_000)];
    expect(findNextMarkerTime(markers, 0, FPS)).toBe(1_000_000);
  });

  it('does not get stuck when currentTime is slightly off due to frame quantization', () => {
    // 30 fps => frame = 33333.33 us. 1_000_000 rounds to 1_000_000 (exact at 30fps? 1e6/30 = 33333.33, 30 frames = 999999.99 ≈ 1000000)
    const markers = [makeMarker(1_000_000), makeMarker(2_000_000)];
    // If currentTime quantizes to 1_000_000, next should still be 2_000_000
    expect(findNextMarkerTime(markers, 1_000_000, FPS)).toBe(2_000_000);
  });

  it('handles non-30fps quantization correctly', () => {
    // 25 fps => frame = 40000 us. 1_000_000 -> 25 frames exactly.
    const markers = [makeMarker(1_000_000), makeMarker(2_000_000)];
    expect(findNextMarkerTime(markers, 1_000_000, 25)).toBe(2_000_000);
  });
});

describe('findPreviousMarkerTime', () => {
  it('returns undefined when no markers exist', () => {
    expect(findPreviousMarkerTime([], 0, FPS)).toBeUndefined();
  });

  it('jumps back to a point marker', () => {
    const markers = [makeMarker(1_000_000)];
    expect(findPreviousMarkerTime(markers, 2_000_000, FPS)).toBe(1_000_000);
  });

  it('jumps from after a zone to its end', () => {
    const markers = [makeMarker(0, 1_000_000)];
    expect(findPreviousMarkerTime(markers, 2_000_000, FPS)).toBe(1_000_000);
  });

  it('jumps from inside a zone back to its start', () => {
    const markers = [makeMarker(0, 1_000_000)];
    expect(findPreviousMarkerTime(markers, 500_000, FPS)).toBe(0);
  });

  it('jumps from zone end to zone start', () => {
    const markers = [makeMarker(0, 1_000_000)];
    expect(findPreviousMarkerTime(markers, 1_000_000, FPS)).toBe(0);
  });

  it('skips duplicate boundary points (zone end == next start)', () => {
    const markers = [makeMarker(0, 1_000_000), makeMarker(1_000_000)];
    // from after 1_000_000, previous should be 1_000_000 (the closest previous unique point)
    expect(findPreviousMarkerTime(markers, 2_000_000, FPS)).toBe(1_000_000);
    // from 1_000_000, previous should be 0
    expect(findPreviousMarkerTime(markers, 1_000_000, FPS)).toBe(0);
  });

  it('handles multiple markers with same start time', () => {
    const markers = [makeMarker(0), makeMarker(0), makeMarker(1_000_000)];
    expect(findPreviousMarkerTime(markers, 1_000_000, FPS)).toBe(0);
  });

  it('does not get stuck when currentTime is slightly off due to frame quantization', () => {
    const markers = [makeMarker(1_000_000), makeMarker(2_000_000)];
    expect(findPreviousMarkerTime(markers, 2_000_000, FPS)).toBe(1_000_000);
  });
});
