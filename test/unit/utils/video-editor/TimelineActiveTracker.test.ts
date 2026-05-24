/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

import { TimelineActiveTracker } from '~/utils/video-editor/TimelineActiveTracker';

interface Clip {
  id: string;
  startUs: number;
  endUs: number;
}

function clip(params: { id: string; startUs: number; endUs: number }): Clip {
  return { id: params.id, startUs: params.startUs, endUs: params.endUs };
}

describe('TimelineActiveTracker', () => {
  it('activates clips when moving forward and deactivates when passing end', () => {
    const tracker = new TimelineActiveTracker<Clip>({
      getId: (c) => c.id,
      getStartUs: (c) => c.startUs,
      getEndUs: (c) => c.endUs,
    });

    const clips = [
      clip({ id: 'a', startUs: 0, endUs: 10 }),
      clip({ id: 'b', startUs: 5, endUs: 8 }),
      clip({ id: 'c', startUs: 20, endUs: 30 }),
    ];

    const deactivated: string[] = [];
    const onDeactivate = (c: Clip) => deactivated.push(c.id);

    const r0 = tracker.update({ clips, timeUs: 0, lastTimeUs: 0, onDeactivate });
    expect(r0.activeClips.map((c) => c.id)).toEqual(['a']);

    const r1 = tracker.update({ clips, timeUs: 6, lastTimeUs: 0, onDeactivate });
    expect(r1.activeClips.map((c) => c.id).sort()).toEqual(['a', 'b']);

    const r2 = tracker.update({ clips, timeUs: 9, lastTimeUs: 6, onDeactivate });
    expect(r2.activeClips.map((c) => c.id)).toEqual(['a']);
    expect(deactivated).toContain('b');

    const r3 = tracker.update({ clips, timeUs: 15, lastTimeUs: 9, onDeactivate });
    expect(r3.activeClips.map((c) => c.id)).toEqual([]);
    expect(deactivated).toContain('a');

    const r4 = tracker.update({ clips, timeUs: 25, lastTimeUs: 15, onDeactivate });
    expect(r4.activeClips.map((c) => c.id)).toEqual(['c']);
  });

  it('recomputes correctly when seeking backward', () => {
    const tracker = new TimelineActiveTracker<Clip>({
      getId: (c) => c.id,
      getStartUs: (c) => c.startUs,
      getEndUs: (c) => c.endUs,
    });

    const clips = [
      clip({ id: 'a', startUs: 0, endUs: 10 }),
      clip({ id: 'b', startUs: 10, endUs: 20 }),
    ];

    const onDeactivate = vi.fn();

    tracker.update({ clips, timeUs: 15, lastTimeUs: 0, onDeactivate });
    const rBack = tracker.update({ clips, timeUs: 5, lastTimeUs: 15, onDeactivate });

    expect(rBack.activeClips.map((c) => c.id)).toEqual(['a']);
  });

  it('stays correct when the caller-provided lastTimeUs is stale (failed-present render)', () => {
    // Repro for the "previous text clip stays in the monitor" bug: a render can advance
    // the tracker (deactivating the old clip in the scene graph) but bail before it
    // presents, so the externally tracked render time never moves forward. If the tracker
    // trusted that stale time it would pick the wrong forward/backward branch on the next
    // seek and strand the already-passed clip as active. The tracker now uses its own
    // internal lastTimeUs, so a stale param must not change the outcome.
    const tracker = new TimelineActiveTracker<Clip>({
      getId: (c) => c.id,
      getStartUs: (c) => c.startUs,
      getEndUs: (c) => c.endUs,
    });

    const clips = [
      clip({ id: 'a', startUs: 0, endUs: 100 }),
      clip({ id: 'b', startUs: 100, endUs: 200 }),
    ];

    const deactivated: string[] = [];
    const onDeactivate = (c: Clip) => deactivated.push(c.id);

    // On clip A.
    const onA = tracker.update({ clips, timeUs: 50, lastTimeUs: 50, onDeactivate });
    expect(onA.activeClips.map((c) => c.id)).toEqual(['a']);

    // Seek to clip B. This advances the tracker, but imagine this render never presented,
    // so the caller's render time is still pinned at 50.
    const onB = tracker.update({ clips, timeUs: 150, lastTimeUs: 50, onDeactivate });
    expect(onB.activeClips.map((c) => c.id)).toEqual(['b']);

    // Seek back onto clip A while the caller still reports the stale lastTimeUs of 50.
    // 50 >= 50 would be treated as moving forward and keep 'b' active — the bug. With the
    // internal lastTimeUs (now 150) this is correctly a backward seek and re-activates 'a'.
    const back = tracker.update({ clips, timeUs: 50, lastTimeUs: 50, onDeactivate });
    expect(back.activeClips.map((c) => c.id)).toEqual(['a']);
    expect(deactivated).toContain('b');
  });

  it('deactivates previously active clips when seeking backward before their start', () => {
    const tracker = new TimelineActiveTracker<Clip>({
      getId: (c) => c.id,
      getStartUs: (c) => c.startUs,
      getEndUs: (c) => c.endUs,
    });

    const clips = [
      clip({ id: 'a', startUs: 10, endUs: 20 }),
      clip({ id: 'b', startUs: 30, endUs: 40 }),
    ];

    const deactivated: string[] = [];
    const onDeactivate = (c: Clip) => deactivated.push(c.id);

    tracker.update({ clips, timeUs: 15, lastTimeUs: 0, onDeactivate });
    tracker.update({ clips, timeUs: 0, lastTimeUs: 15, onDeactivate });

    expect(deactivated).toContain('a');
  });
});
