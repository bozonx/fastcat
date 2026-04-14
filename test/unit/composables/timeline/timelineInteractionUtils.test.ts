/** @vitest-environment happy-dom */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { TimelineTrack } from '~/timeline/types';
import {
  resolveMoveTargetTrackId,
  resolvePlayheadClickTimeUs,
} from '~/composables/timeline/timelineInteractionUtils';

describe('timelineInteractionUtils', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('prefers track row by Y position over elementsFromPoint result', () => {
    const track1 = document.createElement('div');
    track1.dataset.trackId = 'v1';
    vi.spyOn(track1, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      bottom: 50,
      left: 0,
      right: 300,
      width: 300,
      height: 50,
      toJSON: () => ({}),
    });

    const track2 = document.createElement('div');
    track2.dataset.trackId = 'v2';
    vi.spyOn(track2, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 50,
      top: 50,
      bottom: 100,
      left: 0,
      right: 300,
      width: 300,
      height: 50,
      toJSON: () => ({}),
    });

    document.body.append(track1, track2);

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [track1]),
    });

    const result = resolveMoveTargetTrackId({
      clientX: 100,
      clientY: 75,
      draggingTrackId: 'v1',
      tracks: [
        { id: 'v1', kind: 'video', locked: false, items: [] },
        { id: 'v2', kind: 'video', locked: false, items: [] },
      ] as TimelineTrack[],
    });

    expect(result).toBe('v2');
  });

  it('snaps playhead click to nearest enabled timeline point', () => {
    const result = resolvePlayheadClickTimeUs({
      rawTimeUs: 1_030_000,
      zoom: 50,
      snapThresholdPx: 8,
      toolbarSnapMode: 'snap',
      snapping: {
        timelineEdges: true,
        clips: true,
        markers: true,
        selection: true,
        playhead: true,
        playheadClick: true,
      },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          locked: false,
          items: [
            {
              id: 'clip-1',
              kind: 'clip',
              timelineRange: { startUs: 3_000_000, durationUs: 1_000_000 },
            },
          ],
        },
      ] as TimelineTrack[],
      markers: [{ id: 'marker-1', timeUs: 1_000_000, text: '' }],
      durationUs: 10_000_000,
      selectionRangeUs: { startUs: 5_000_000, endUs: 6_000_000 },
    });

    expect(result).toBe(1_000_000);
  });

  it('does not snap playhead click when the option is disabled', () => {
    const result = resolvePlayheadClickTimeUs({
      rawTimeUs: 1_030_000,
      zoom: 50,
      snapThresholdPx: 8,
      toolbarSnapMode: 'snap',
      snapping: {
        timelineEdges: true,
        clips: true,
        markers: true,
        selection: true,
        playhead: true,
        playheadClick: false,
      },
      tracks: [] as TimelineTrack[],
      markers: [{ id: 'marker-1', timeUs: 1_000_000, text: '' }],
      durationUs: 10_000_000,
      selectionRangeUs: null,
    });

    expect(result).toBe(1_030_000);
  });

  it('enables playhead click snapping by default in user settings', async () => {
    const { DEFAULT_USER_SETTINGS } = await import('~/utils/settings/defaults');

    expect(DEFAULT_USER_SETTINGS.timeline.snapping.playheadClick).toBe(true);
  });
});
