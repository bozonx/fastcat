/** @vitest-environment node */
/**
 * Property-based invariant tests for the pure timeline command reducer.
 *
 * The per-command unit tests pin behaviour on hand-picked inputs. These tests
 * instead throw *randomised sequences* of commands at `applyTimelineCommand`
 * and assert that a small set of structural invariants always hold, no matter
 * what order operations arrive in. Domain rejections (overlap, locks, etc.)
 * are expected and simply skipped — we only assert invariants on the documents
 * that a command actually produced.
 */
import { describe, it, expect } from 'vitest';
import { timelineTicks } from '../utils/timeline-time';
import fc from 'fast-check';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineCommand } from '~/timeline/commands';
import { rangesOverlap, OVERLAP_EPSILON_TICKS, frameToTicks } from '~/timeline/commands/utils';
import type {
  TimelineDocument,
  TimelineTrack,
  TimelineClipItem,
  TimelineTrackItem,
} from '~/timeline/types';

const FPS = 30;

interface ClipSpec {
  trackId: string;
  startTicks: number;
  durationTicks: number;
}

function makeMediaClip(
  id: string,
  trackId: string,
  spec: Omit<ClipSpec, 'trackId'>,
): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id,
    trackId,
    name: id,
    source: { path: `${id}.mp4` },
    sourceDurationTicks: timelineTicks(60_000_000),
    timelineRange: { startTicks: spec.startTicks, durationTicks: spec.durationTicks },
    sourceRange: { startTicks: 0, durationTicks: spec.durationTicks },
  } as TimelineClipItem;
}

function makeDoc(clipsByTrack: Record<string, Omit<ClipSpec, 'trackId'>[]>): TimelineDocument {
  const tracks: TimelineTrack[] = Object.entries(clipsByTrack).map(([trackId, clips], ti) => ({
    id: trackId,
    kind: trackId.startsWith('a') ? 'audio' : 'video',
    name: trackId.toUpperCase(),
    items: clips.map((c, i) => makeMediaClip(`${trackId}-c${ti}-${i}`, trackId, c)),
  }));
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'prop-doc',
    name: 'Property Doc',
    timebase: { fps: FPS },
    tracks,
  };
}

/** A three-track document: two video tracks and one audio, each seeded with clips. */
function seedDoc(): TimelineDocument {
  return makeDoc({
    v1: [
      { startTicks: 0, durationTicks: timelineTicks(1_000_000) },
      { startTicks: timelineTicks(1_000_000), durationTicks: timelineTicks(2_000_000) },
      { startTicks: timelineTicks(4_000_000), durationTicks: timelineTicks(1_000_000) },
    ],
    v2: [
      { startTicks: 0, durationTicks: timelineTicks(3_000_000) },
      { startTicks: timelineTicks(5_000_000), durationTicks: timelineTicks(1_000_000) },
    ],
    a1: [{ startTicks: 0, durationTicks: timelineTicks(6_000_000) }],
  });
}

/** Returns a list of human-readable invariant violations for the document. */
function invariantViolations(doc: TimelineDocument): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  for (const track of doc.tracks) {
    const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');

    for (const it of track.items) {
      // 1. Unique ids across the whole document.
      if (seenIds.has(it.id)) problems.push(`duplicate id ${it.id}`);
      seenIds.add(it.id);

      // 2. Non-negative start, strictly positive duration for every item.
      if (it.timelineRange.startTicks < 0) {
        problems.push(`${it.id} has negative start ${it.timelineRange.startTicks}`);
      }
      if (it.timelineRange.durationTicks <= 0) {
        problems.push(`${it.id} has non-positive duration ${it.timelineRange.durationTicks}`);
      }

      // 3. Every item's trackId points at its containing track.
      if (it.trackId !== undefined && it.trackId !== track.id) {
        problems.push(`${it.id}.trackId=${it.trackId} but lives on ${track.id}`);
      }
    }

    // 4. Clips on the same track never meaningfully overlap.
    const ordered = [...clips].sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]!;
      const cur = ordered[i]!;
      const prevStart = prev.timelineRange.startTicks;
      const prevEnd = prevStart + prev.timelineRange.durationTicks;
      const curStart = cur.timelineRange.startTicks;
      const curEnd = curStart + cur.timelineRange.durationTicks;
      if (
        rangesOverlap(prevStart, prevEnd, curStart, curEnd) &&
        Math.min(prevEnd, curEnd) - Math.max(prevStart, curStart) > OVERLAP_EPSILON_TICKS
      ) {
        problems.push(
          `overlap on ${track.id}: ${prev.id}[${prevStart},${prevEnd}] vs ${cur.id}[${curStart},${curEnd}]`,
        );
      }
    }

    // 5. Source range durations stay positive for media clips.
    for (const clip of clips) {
      const sr = (clip as { sourceRange?: { durationTicks: number } }).sourceRange;
      if (sr && sr.durationTicks <= 0) {
        problems.push(`${clip.id} has non-positive sourceRange duration ${sr.durationTicks}`);
      }
    }
  }

  return problems;
}

function clipRefs(doc: TimelineDocument): { trackId: string; itemId: string }[] {
  const refs: { trackId: string; itemId: string }[] = [];
  for (const track of doc.tracks) {
    for (const it of track.items) {
      if (it.kind === 'clip') refs.push({ trackId: track.id, itemId: it.id });
    }
  }
  return refs;
}

function findClip(doc: TimelineDocument, itemId: string): TimelineClipItem | undefined {
  for (const track of doc.tracks) {
    const found = track.items.find((it) => it.id === itemId);
    if (found && found.kind === 'clip') return found;
  }
  return undefined;
}

// --- Randomised action model ------------------------------------------------

type Action =
  | { kind: 'add'; trackIndex: number; startTicks: number; durationTicks: number; addId: number }
  | { kind: 'move'; itemIndex: number; startTicks: number }
  | { kind: 'trim'; itemIndex: number; edge: 'start' | 'end'; deltaTicks: number }
  | { kind: 'split'; itemIndex: number; atFraction: number }
  | { kind: 'remove'; itemIndex: number };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant('add' as const),
    trackIndex: fc.nat(),
    startTicks: fc.integer({ min: 0, max: timelineTicks(20_000_000) }),
    durationTicks: fc.integer({ min: timelineTicks(100_000), max: timelineTicks(5_000_000) }),
    addId: fc.nat(),
  }),
  fc.record({
    kind: fc.constant('move' as const),
    itemIndex: fc.nat(),
    startTicks: fc.integer({ min: 0, max: timelineTicks(20_000_000) }),
  }),
  fc.record({
    kind: fc.constant('trim' as const),
    itemIndex: fc.nat(),
    edge: fc.constantFrom('start' as const, 'end' as const),
    deltaTicks: fc.integer({ min: -timelineTicks(3_000_000), max: timelineTicks(3_000_000) }),
  }),
  fc.record({
    kind: fc.constant('split' as const),
    itemIndex: fc.nat(),
    atFraction: fc.double({ min: 0, max: 1, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant('remove' as const),
    itemIndex: fc.nat(),
  }),
);

/** Translate a randomised action into a concrete command against `doc`, or null. */
function toCommand(doc: TimelineDocument, action: Action): TimelineCommand | null {
  if (action.kind === 'add') {
    const track = doc.tracks[action.trackIndex % doc.tracks.length];
    if (!track) return null;
    return {
      type: 'add_clip_to_track',
      trackId: track.id,
      name: `added-${action.addId}`,
      path: `added-${action.addId}.mp4`,
      startTicks: action.startTicks,
      durationTicks: action.durationTicks,
      sourceDurationTicks: timelineTicks(60_000_000),
    };
  }

  const refs = clipRefs(doc);
  if (refs.length === 0) return null;
  const ref = refs[action.itemIndex % refs.length]!;

  switch (action.kind) {
    case 'move':
      return {
        type: 'move_item',
        trackId: ref.trackId,
        itemId: ref.itemId,
        startTicks: action.startTicks,
      };
    case 'trim':
      return {
        type: 'trim_item',
        trackId: ref.trackId,
        itemId: ref.itemId,
        edge: action.edge,
        deltaTicks: action.deltaTicks,
      };
    case 'split': {
      const clip = findClip(doc, ref.itemId)!;
      const { startTicks, durationTicks } = clip.timelineRange;
      const atTicks = Math.round(startTicks + durationTicks * action.atFraction);
      return { type: 'split_item', trackId: ref.trackId, itemId: ref.itemId, atTicks };
    }
    case 'remove':
      return { type: 'remove_item', trackId: ref.trackId, itemId: ref.itemId };
  }
}

describe('timeline command invariants (property-based)', () => {
  it('preserves structural invariants across random command sequences', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 40 }), (actions) => {
        let doc = seedDoc();
        // The seed itself must be valid.
        expect(invariantViolations(doc)).toEqual([]);

        for (const action of actions) {
          const cmd = toCommand(doc, action);
          if (!cmd) continue;
          let next: TimelineDocument;
          try {
            next = applyTimelineCommand(doc, cmd).next;
          } catch {
            // Domain rejection (overlap, lock, out-of-bounds) — document unchanged.
            continue;
          }
          const violations = invariantViolations(next);
          if (violations.length > 0) {
            throw new Error(`invariants broken after ${cmd.type}: ${violations.join('; ')}`);
          }
          doc = next;
        }
      }),
      { numRuns: 300 },
    );
  });

  it('split conserves timeline coverage and source duration (no overlap, no gap)', () => {
    fc.assert(
      fc.property(
        // Frame-aligned clip length (15..300 frames) so quantized coverage is exact.
        fc.integer({ min: 15, max: 300 }),
        fc.double({ min: 0.05, max: 0.95, noNaN: true }), // split fraction
        (frameCount, fraction) => {
          const durationTicks = frameToTicks(frameCount, FPS);
          const doc = makeDoc({ v1: [{ startTicks: 0, durationTicks }] });
          const original = findClip(doc, 'v1-c0-0')!;
          const atTicks = Math.round(original.timelineRange.durationTicks * fraction);

          const { next } = applyTimelineCommand(doc, {
            type: 'split_item',
            trackId: 'v1',
            itemId: 'v1-c0-0',
            atTicks,
          });

          const clips = next.tracks[0]!.items.filter(
            (it): it is TimelineClipItem => it.kind === 'clip',
          );

          // Split point may land on a frame boundary and become a no-op; only
          // assert conservation when a real split happened.
          if (clips.length === 1) {
            expect(invariantViolations(next)).toEqual([]);
            return;
          }

          expect(clips.length).toBe(2);
          expect(invariantViolations(next)).toEqual([]);

          const ordered = [...clips].sort(
            (a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks,
          );
          const [left, right] = ordered;

          // No gap between the halves.
          expect(right!.timelineRange.startTicks).toBe(
            left!.timelineRange.startTicks + left!.timelineRange.durationTicks,
          );

          // Timeline coverage is conserved exactly (frame-aligned input).
          const totalTimeline = left!.timelineRange.durationTicks + right!.timelineRange.durationTicks;
          expect(totalTimeline).toBe(original.timelineRange.durationTicks);

          // Source range is conserved and contiguous.
          const leftSrc = (left as { sourceRange: { startTicks: number; durationTicks: number } })
            .sourceRange;
          const rightSrc = (right as { sourceRange: { startTicks: number; durationTicks: number } })
            .sourceRange;
          expect(rightSrc.startTicks).toBe(leftSrc.startTicks + leftSrc.durationTicks);
          const totalSrc = leftSrc.durationTicks + rightSrc.durationTicks;
          const originalSrc = (original as { sourceRange: { durationTicks: number } }).sourceRange
            .durationTicks;
          expect(Math.abs(totalSrc - originalSrc)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('remove deletes exactly the targeted clip and keeps the document valid', () => {
    fc.assert(
      fc.property(fc.nat(), (pick) => {
        const doc = seedDoc();
        const refs = clipRefs(doc);
        const ref = refs[pick % refs.length]!;

        const { next } = applyTimelineCommand(doc, {
          type: 'remove_item',
          trackId: ref.trackId,
          itemId: ref.itemId,
        });

        expect(findClip(next, ref.itemId)).toBeUndefined();
        expect(invariantViolations(next)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
