import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '../../types';
import type { TimelineCommandResult } from '../../commands';
import {
  quantizeTimeUsToFrames,
  assertNoOverlap,
  normalizeGaps,
} from '../utils';

/**
 * Handles the `speed` property of an `updateClipProperties` edit.
 *
 * Mutates `nextProps` in place (sets/clears `speed` and `timelineRange`) and
 * returns:
 *  - `null` when the caller should keep applying the remaining properties, or
 *  - a fully built `TimelineCommandResult` when slowing the clip forced a
 *    ripple shift of downstream clips (that path produces the final document
 *    itself, so the caller must return it directly).
 *
 * Throws `'Speed cannot be 0'` or `'Item overlaps with another item'` to mirror
 * the original inline behavior.
 */
export function applyClipSpeedChange(params: {
  doc: TimelineDocument;
  track: TimelineTrack;
  item: TimelineClipItem;
  fps: number;
  nextProps: Record<string, unknown>;
}): TimelineCommandResult | null {
  const { doc, track, item, fps, nextProps } = params;
  if (!('speed' in nextProps)) return null;

  const raw = nextProps['speed'];
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
  const speed = v === undefined ? undefined : Math.max(-10, Math.min(10, v));
  if (speed === 0) {
    throw new Error('Speed cannot be 0');
  }
  if (speed === undefined) {
    delete nextProps.speed;
    return null;
  }

  nextProps.speed = speed;
  const nextDurationUsRaw = Math.round(item.sourceRange.durationUs / Math.abs(speed));
  const nextDurationUs = Math.max(0, quantizeTimeUsToFrames(nextDurationUsRaw, fps, 'round'));
  const startUs = item.timelineRange.startUs;
  const prevDurationUs = Math.max(0, item.timelineRange.durationUs);

  const shouldTryRipple = nextDurationUs !== prevDurationUs;
  if (!shouldTryRipple) {
    assertNoOverlap(track, item.id, startUs, nextDurationUs);
    nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
    return null;
  }

  try {
    if (nextDurationUs > prevDurationUs) {
      assertNoOverlap(track, item.id, startUs, nextDurationUs);
    }
    nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
    return null;
  } catch {
    // Exception means overlap occurred (or we want to explicitly ripple shift)
    const clips = track.items
      .filter((it): it is TimelineClipItem => it.kind === 'clip')
      .map((c) => ({ ...c, timelineRange: { ...c.timelineRange } }));
    clips.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

    const movedVideoClipIds: string[] = [];
    const nextClips = clips.map((c) => {
      if (c.id !== item.id) return c;
      return {
        ...c,
        speed,
        timelineRange: { ...c.timelineRange, durationUs: nextDurationUs },
      };
    });

    // Calculate how much the clips after this one should move
    const deltaUs = nextDurationUs - prevDurationUs;
    let foundCurrent = false;

    for (let i = 0; i < nextClips.length; i++) {
      const curr = nextClips[i];
      if (!curr) continue;

      if (curr.id === item.id) {
        foundCurrent = true;
        continue;
      }

      if (foundCurrent) {
        // Ripple only shifts unlocked downstream clips. Stop the ripple
        // when we hit a locked clip — silently shoving past it would lose
        // the lock invariant — but still throw an overlap error if the
        // new geometry would collide with the locked clip.
        if (curr.locked) {
          const lockedStartUs = curr.timelineRange.startUs;
          const rippledEndOfCurrent = nextClips
            .slice(0, i)
            .reduce(
              (max, c) => Math.max(max, c.timelineRange.startUs + c.timelineRange.durationUs),
              0,
            );
          if (rippledEndOfCurrent > lockedStartUs + 1) {
            throw new Error('Item overlaps with another item');
          }
          break;
        }

        const newStartUs = Math.max(0, curr.timelineRange.startUs + deltaUs);
        const qStartUs = quantizeTimeUsToFrames(newStartUs, fps, 'round');
        if (qStartUs !== curr.timelineRange.startUs) {
          nextClips[i] = {
            ...curr,
            timelineRange: { ...curr.timelineRange, startUs: qStartUs },
          };
          if (track.kind === 'video') {
            movedVideoClipIds.push(curr.id);
          }
        }
      }
    }

    // Cross-check rippled layout for residual overlaps; rounding can put
    // two clips on the same frame even when delta math is exact.
    for (let i = 1; i < nextClips.length; i++) {
      const prev = nextClips[i - 1]!;
      const cur = nextClips[i]!;
      const prevEnd = prev.timelineRange.startUs + prev.timelineRange.durationUs;
      if (cur.timelineRange.startUs + 1 < prevEnd) {
        throw new Error('Item overlaps with another item');
      }
    }

    let nextTracksLocal = doc.tracks.map((t) =>
      t.id === track.id
        ? { ...t, items: normalizeGaps(doc, t.id, nextClips, { quantizeToFrames: true }) }
        : t,
    );



    return { next: { ...doc, tracks: nextTracksLocal } };
  }
}
