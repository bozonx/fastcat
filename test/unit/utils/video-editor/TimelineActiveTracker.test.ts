import { describe, it, expect, vi } from 'vitest';

import { TimelineActiveTracker } from '../../../../src/utils/video-editor/TimelineActiveTracker';

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

    const clips = [clip({ id: 'a', startUs: 0, endUs: 10 }), clip({ id: 'b', startUs: 10, endUs: 20 })];

    const onDeactivate = vi.fn();

    tracker.update({ clips, timeUs: 15, lastTimeUs: 0, onDeactivate });
    const rBack = tracker.update({ clips, timeUs: 5, lastTimeUs: 15, onDeactivate });

    expect(rBack.activeClips.map((c) => c.id)).toEqual(['a']);
  });
});
