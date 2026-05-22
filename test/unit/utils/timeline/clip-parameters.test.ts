import { describe, expect, it } from 'vitest';
import type { TimelineClipItem } from '~/timeline/types';
import {
  buildClipParametersPatch,
  createClipParametersSnapshot,
  getApplicableClipParameterGroups,
} from '~/utils/timeline/clip-parameters';

function makeClip(patch: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'v1',
    name: 'Clip',
    source: { path: 'source.mp4' },
    sourceDurationUs: 10_000_000,
    timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
    sourceRange: { startUs: 100_000, durationUs: 2_000_000 },
    ...patch,
  } as TimelineClipItem;
}

describe('clip parameters clipboard helpers', () => {
  it('copies transferable clip parameters without identity, source or ranges', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        id: 'source-clip',
        trackId: 'v2',
        transform: { scale: { x: 2, y: 2 } },
        opacity: 0.5,
        speed: 1.5,
        effects: [
          { id: 'fx-video', manifestId: 'blur', params: {}, target: 'video' },
          { id: 'fx-audio', manifestId: 'echo', params: {}, target: 'audio' },
        ],
        transitionIn: { type: 'fade', durationUs: 200_000 },
      }),
    });

    expect(snapshot.groups.transform).toEqual({ transform: { scale: { x: 2, y: 2 } } });
    expect(snapshot.groups.opacity).toEqual({ opacity: 0.5 });
    expect(snapshot.groups.speed).toEqual({ speed: 1.5 });
    expect(snapshot.groups.videoEffects?.effects).toHaveLength(1);
    expect(snapshot.groups.audioEffects?.effects).toHaveLength(1);
    expect(snapshot.groups.transitions?.transitionIn).toEqual({
      type: 'fade',
      durationUs: 200_000,
    });
    expect(JSON.stringify(snapshot)).not.toContain('source-clip');
    expect(JSON.stringify(snapshot)).not.toContain('source.mp4');
    expect(JSON.stringify(snapshot)).not.toContain('timelineRange');
    expect(JSON.stringify(snapshot)).not.toContain('sourceRange');
  });

  it('filters groups by target compatibility', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        transform: { position: { x: 10, y: 20 } },
        audioGain: 0.5,
        backgroundColor: '#112233',
        style: { fontSize: 42 },
      }),
    });

    const audioTarget = makeClip({ trackId: 'a1' });
    const audioGroups = getApplicableClipParameterGroups({
      snapshot,
      targetClip: audioTarget,
      targetTrackKind: 'audio',
    }).map((group) => group.id);

    expect(audioGroups).toContain('audio');
    expect(audioGroups).not.toContain('transform');
    expect(audioGroups).not.toContain('background');
    expect(audioGroups).not.toContain('text');
  });

  it('builds a patch for selected groups and preserves target effects outside selected groups', () => {
    const snapshot = createClipParametersSnapshot({
      trackKind: 'video',
      clip: makeClip({
        opacity: 0.25,
        effects: [
          { id: 'copied-video', manifestId: 'blur', params: {}, target: 'video' },
          { id: 'copied-audio', manifestId: 'echo', params: {}, target: 'audio' },
        ],
      }),
    });

    const target = makeClip({
      effects: [
        { id: 'target-video', manifestId: 'bloom', params: {}, target: 'video' },
        { id: 'target-audio', manifestId: 'compressor', params: {}, target: 'audio' },
      ],
    });

    const patch = buildClipParametersPatch({
      snapshot,
      targetClip: target,
      targetTrackKind: 'video',
      groups: ['opacity', 'videoEffects'],
    });

    expect(patch.properties.opacity).toBe(0.25);
    expect(patch.properties.effects).toEqual([
      { id: 'copied-video', manifestId: 'blur', params: {}, target: 'video' },
      { id: 'target-audio', manifestId: 'compressor', params: {}, target: 'audio' },
    ]);
  });
});
