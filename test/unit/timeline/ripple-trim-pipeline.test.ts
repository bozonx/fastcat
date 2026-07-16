/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { timelineTicks } from '../utils/timeline-time';
import { applyTimelineCommand } from '~/timeline/commands';
import { createTimelineEditService } from '~/timeline/application/timelineEditService';
import type {
  TimelineDocument,
  TimelineCommand,
  TimelineClipItem,
  TimelineTrackItem,
} from '~/timeline/types';

const S = timelineTicks(1_000_000); // 1 second in microseconds

function mediaClip(
  id: string,
  startTicks: number,
  durationTicks: number,
  sourceStartTicks = 0,
): TimelineClipItem {
  return {
    id,
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    name: id,
    timelineRange: { startTicks, durationTicks },
    sourceRange: { startTicks: sourceStartTicks, durationTicks },
    source: { path: '_video/clip.mp4' },
    sourceDurationTicks: 60 * S,
  } as TimelineClipItem;
}

function makeDoc(): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'V1',
        items: [mediaClip('c1', 0, 10 * S), mediaClip('c2', 10 * S, 10 * S)],
      },
    ],
  } as TimelineDocument;
}

/**
 * Drives the edit service against the real command pipeline. The batch helper
 * mirrors the production dispatcher: a batch is atomic, so any "item overlaps"
 * failure rolls the whole batch back (this is exactly what made the buggy
 * rippleTrimLeft silently no-op on multi-clip tracks).
 */
function createHarness(doc: TimelineDocument) {
  const state = {
    doc,
    target: null as { trackId: string; itemId: string } | null,
    selectedIds: [] as string[],
    selectionRange: null as { startTicks: number; endTicks: number } | null,
    currentTime: 0,
  };

  function runBatch(cmds: TimelineCommand[]) {
    let next = state.doc;
    for (const cmd of cmds) {
      try {
        next = applyTimelineCommand(next, cmd).next;
      } catch (error) {
        if (error instanceof Error && error.message === 'Item overlaps with another item') {
          return; // atomic rollback — do not commit
        }
        throw error;
      }
    }
    state.doc = next;
  }

  const service = createTimelineEditService({
    getDoc: () => state.doc,
    getHotkeyTargetClip: () => state.target,
    getSelectedItemIds: () => state.selectedIds,
    getCurrentTime: () => state.currentTime,
    applyTimeline: (cmd) => runBatch([cmd]),
    batchApplyTimeline: (cmds) => runBatch(cmds),
    pushTimelineHistory: () => {},
    requestTimelineSave: () => Promise.resolve(),
    getSelectionRange: () => state.selectionRange,
    updateSelectionRange: (range) => {
      state.selectionRange = range;
    },
  });

  return { state, service };
}

function clips(doc: TimelineDocument): TimelineClipItem[] {
  return doc.tracks[0]!.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
}

function gaps(doc: TimelineDocument): TimelineTrackItem[] {
  return doc.tracks[0]!.items.filter((it) => it.kind === 'gap');
}

function markerTimes(
  doc: TimelineDocument,
): Record<string, { timeTicks: number; durationTicks?: number }> {
  const markers = doc.metadata?.fastcat?.markers ?? [];
  return Object.fromEntries(
    markers.map((marker) => [
      marker.id,
      {
        timeTicks: marker.timeTicks,
        ...(marker.durationTicks === undefined ? {} : { durationTicks: marker.durationTicks }),
      },
    ]),
  );
}

describe('ripple trims / deletes — real pipeline geometry', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    h = createHarness(makeDoc());
  });

  it('rippleTrimLeft slides the remnant to the original left edge (no gap, no overlap)', async () => {
    h.state.target = { trackId: 'v1', itemId: 'c1' };
    h.state.currentTime = 5 * S;

    await h.service.rippleTrimLeft();

    const result = clips(h.state.doc).sort(
      (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
    );
    expect(gaps(h.state.doc)).toHaveLength(0);
    expect(result).toHaveLength(2);

    // c1 keeps its identity, fills [0, 5s], and its source advanced by the cut.
    expect(result[0]!.id).toBe('c1');
    expect(result[0]!.timelineRange).toEqual({ startTicks: 0, durationTicks: 5 * S });
    expect(result[0]!.sourceRange).toEqual({ startTicks: 5 * S, durationTicks: 5 * S });

    // c2 rippled left by the removed span and sits flush after c1.
    expect(result[1]!.id).toBe('c2');
    expect(result[1]!.timelineRange).toEqual({ startTicks: 5 * S, durationTicks: 10 * S });
  });

  it('rippleTrimRight keeps the start fixed and ripples subsequent clips', async () => {
    h.state.target = { trackId: 'v1', itemId: 'c1' };
    h.state.currentTime = 6 * S;

    await h.service.rippleTrimRight();

    const result = clips(h.state.doc).sort(
      (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
    );
    expect(gaps(h.state.doc)).toHaveLength(0);
    expect(result[0]!.timelineRange).toEqual({ startTicks: 0, durationTicks: 6 * S });
    expect(result[1]!.id).toBe('c2');
    expect(result[1]!.timelineRange).toEqual({ startTicks: 6 * S, durationTicks: 10 * S });
  });

  it('advancedRippleTrimLeft removes the head across the track and collapses', async () => {
    h.state.target = { trackId: 'v1', itemId: 'c1' };
    h.state.selectedIds = ['c1'];
    h.state.currentTime = 5 * S;

    await h.service.advancedRippleTrimLeft();

    const result = clips(h.state.doc).sort(
      (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
    );
    expect(gaps(h.state.doc)).toHaveLength(0);
    expect(result).toHaveLength(2);
    // Surviving right half of c1 starts at 0; c2 follows flush.
    expect(result[0]!.timelineRange).toEqual({ startTicks: 0, durationTicks: 5 * S });
    expect(result[1]!.timelineRange).toEqual({ startTicks: 5 * S, durationTicks: 10 * S });
  });

  it('advancedRippleTrimRight removes the tail across the track and collapses', async () => {
    h.state.target = { trackId: 'v1', itemId: 'c1' };
    h.state.selectedIds = ['c1'];
    h.state.currentTime = 6 * S;

    await h.service.advancedRippleTrimRight();

    const result = clips(h.state.doc).sort(
      (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
    );
    expect(gaps(h.state.doc)).toHaveLength(0);
    expect(result[0]!.timelineRange).toEqual({ startTicks: 0, durationTicks: 6 * S });
    expect(result[1]!.timelineRange).toEqual({ startTicks: 6 * S, durationTicks: 10 * S });
  });

  it('rippleDeleteRange spanning two clips splits, deletes the middle, and collapses', () => {
    h.service.rippleDeleteRange({ trackIds: ['v1'], startTicks: 5 * S, endTicks: 15 * S });

    const result = clips(h.state.doc).sort(
      (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
    );
    expect(gaps(h.state.doc)).toHaveLength(0);
    expect(result).toHaveLength(2);
    // Left half of c1 stays put; right half of c2 collapses to the cut point.
    expect(result[0]!.timelineRange).toEqual({ startTicks: 0, durationTicks: 5 * S });
    expect(result[1]!.timelineRange).toEqual({ startTicks: 5 * S, durationTicks: 5 * S });
  });

  it('rippleDeleteRange shifts clips, markers, and the selection range together', () => {
    h.state.doc = {
      ...h.state.doc,
      metadata: {
        fastcat: {
          markers: [
            { id: 'inside', timeTicks: 6 * S, durationTicks: 2 * S, text: '' },
            { id: 'after', timeTicks: 16 * S, durationTicks: 2 * S, text: '' },
          ],
        },
      },
    };
    h.state.selectionRange = { startTicks: 16 * S, endTicks: 18 * S };

    h.service.rippleDeleteRange({ trackIds: ['v1'], startTicks: 5 * S, endTicks: 15 * S });

    const result = clips(h.state.doc).sort(
      (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
    );
    expect(result.map((clip) => clip.timelineRange)).toEqual([
      { startTicks: 0, durationTicks: 5 * S },
      { startTicks: 5 * S, durationTicks: 5 * S },
    ]);
    expect(markerTimes(h.state.doc)).toEqual({
      after: { timeTicks: 6 * S, durationTicks: 2 * S },
    });
    expect(h.state.selectionRange).toEqual({ startTicks: 6 * S, endTicks: 8 * S });
  });
});
