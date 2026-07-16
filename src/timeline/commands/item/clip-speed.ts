import type { TimelineDocument, TimelineTrack, TimelineClipItem } from '../../types';
import type { TimelineCommandResult } from '../../commands';
import { quantizeTimeUsToFrames, assertNoOverlap, normalizeGaps } from '../utils';

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
    nextProps.speedActive = false;
    return null;
  }

  nextProps.speed = speed;
  // The document model (OTIO time-effects) and the worker/native playback payload
  // only honour `speed` when `speedActive` is set: `serializeTimeEffects` emits the
  // LinearTimeWarp only if `speedActive` is truthy, and the payload builder gates
  // `speed` on `item.speedActive !== false`. A speed/reverse edit that left this
  // flag untouched therefore changed the waveform (read from the live `speed`) but
  // never reached playback — video kept playing forward and reversed-clip audio was
  // not muted. Unit speed (1×) carries no time-warp, so the flag clears there.
  nextProps.speedActive = speed !== 1;
  const nextDurationUsRaw = Math.round(item.sourceRange.durationTicks / Math.abs(speed));
  const nextDurationTicks = Math.max(0, quantizeTimeUsToFrames(nextDurationUsRaw, fps, 'round'));
  const startTicks = item.timelineRange.startTicks;
  const prevDurationTicks = Math.max(0, item.timelineRange.durationTicks);

  const shouldTryRipple = nextDurationTicks !== prevDurationTicks;
  if (!shouldTryRipple) {
    assertNoOverlap(track, item.id, startTicks, nextDurationTicks);
    nextProps.timelineRange = { ...item.timelineRange, durationTicks: nextDurationTicks };
    return null;
  }

  try {
    if (nextDurationTicks > prevDurationTicks) {
      assertNoOverlap(track, item.id, startTicks, nextDurationTicks);
    }
    nextProps.timelineRange = { ...item.timelineRange, durationTicks: nextDurationTicks };
    return null;
  } catch {
    // Exception means overlap occurred (or we want to explicitly ripple shift)
    const clips = track.items
      .filter((it): it is TimelineClipItem => it.kind === 'clip')
      .map((c) => ({ ...c, timelineRange: { ...c.timelineRange } }));
    clips.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);

    const movedVideoClipIds: string[] = [];
    const nextClips = clips.map((c) => {
      if (c.id !== item.id) return c;
      return {
        ...c,
        speed,
        speedActive: speed !== 1,
        timelineRange: { ...c.timelineRange, durationTicks: nextDurationTicks },
      };
    });

    // Calculate how much the clips after this one should move
    const deltaTicks = nextDurationTicks - prevDurationTicks;
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
          const lockedStartTicks = curr.timelineRange.startTicks;
          const rippledEndOfCurrent = nextClips
            .slice(0, i)
            .reduce(
              (max, c) => Math.max(max, c.timelineRange.startTicks + c.timelineRange.durationTicks),
              0,
            );
          if (rippledEndOfCurrent > lockedStartTicks) {
            throw new Error('Item overlaps with another item');
          }
          break;
        }

        const newStartTicks = Math.max(0, curr.timelineRange.startTicks + deltaTicks);
        if (newStartTicks !== curr.timelineRange.startTicks) {
          nextClips[i] = {
            ...curr,
            timelineRange: { ...curr.timelineRange, startTicks: newStartTicks },
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
      const prevEnd = prev.timelineRange.startTicks + prev.timelineRange.durationTicks;
      if (cur.timelineRange.startTicks < prevEnd) {
        throw new Error('Item overlaps with another item');
      }
    }

    const nextTracksLocal = doc.tracks.map((t) =>
      t.id === track.id
        ? { ...t, items: normalizeGaps(doc, t.id, nextClips, { quantizeToFrames: true }) }
        : t,
    );

    return { next: { ...doc, tracks: nextTracksLocal } };
  }
}
