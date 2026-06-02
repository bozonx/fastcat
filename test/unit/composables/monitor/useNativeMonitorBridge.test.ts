import { describe, expect, it } from 'vitest';

import {
  isNativeMonitorSceneReady,
  resolveNativeAudioTrackSelection,
  shouldSyncNativeMonitorTime,
} from '~/composables/monitor/useNativeMonitorBridge';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';

function track(id: string, kind: 'audio' | 'video', props: Partial<TimelineTrack>): TimelineTrack {
  return {
    id,
    kind,
    name: id,
    items: [],
    ...props,
  } as TimelineTrack;
}

describe('resolveNativeAudioTrackSelection', () => {
  it('uses muted filters when no track is soloed', () => {
    const result = resolveNativeAudioTrackSelection({
      visibleVideoTracks: [
        track('v1', 'video', { audioMuted: false }),
        track('v2', 'video', { audioMuted: true }),
      ],
      audioTracks: [
        track('a1', 'audio', { audioMuted: true }),
        track('a2', 'audio', { audioMuted: false }),
      ],
    });

    expect(result.hasAudioSolo).toBe(false);
    expect(result.videoTracksForAudio.map((t) => t.id)).toEqual(['v1']);
    expect(result.audioTracksForAudio.map((t) => t.id)).toEqual(['a2']);
  });

  it('lets solo override muted state for native audio preview', () => {
    const result = resolveNativeAudioTrackSelection({
      visibleVideoTracks: [
        track('v1', 'video', { audioMuted: false }),
        track('v2', 'video', { audioMuted: true, audioSolo: true }),
      ],
      audioTracks: [
        track('a1', 'audio', { audioMuted: false }),
        track('a2', 'audio', { audioMuted: true, audioSolo: true }),
      ],
    });

    expect(result.hasAudioSolo).toBe(true);
    expect(result.videoTracksForAudio.map((t) => t.id)).toEqual(['v2']);
    expect(result.audioTracksForAudio.map((t) => t.id)).toEqual(['a2']);
  });
});

describe('shouldSyncNativeMonitorTime', () => {
  it('throttles small native time updates', () => {
    expect(shouldSyncNativeMonitorTime({ diffUs: 300, nowMs: 100, lastSyncMs: 0 })).toBe(false);
    expect(shouldSyncNativeMonitorTime({ diffUs: 10_000, nowMs: 120, lastSyncMs: 100 })).toBe(
      false,
    );
    expect(shouldSyncNativeMonitorTime({ diffUs: 10_000, nowMs: 160, lastSyncMs: 100 })).toBe(true);
  });

  it('forces large native time jumps through the throttle', () => {
    expect(shouldSyncNativeMonitorTime({ diffUs: 120_000, nowMs: 120, lastSyncMs: 100 })).toBe(
      true,
    );
  });
});

describe('isNativeMonitorSceneReady', () => {
  const emptyDoc = {
    id: 'timeline-1',
    name: 'Timeline 1',
    tracks: [],
  } as TimelineDocument;

  it('blocks native scene sync before the active project timeline is loaded', () => {
    expect(
      isNativeMonitorSceneReady({
        currentProjectName: null,
        currentTimelinePath: null,
        timelineDoc: null,
      }),
    ).toBe(false);

    expect(
      isNativeMonitorSceneReady({
        currentProjectName: 'Project',
        currentTimelinePath: null,
        timelineDoc: emptyDoc,
      }),
    ).toBe(false);
  });

  it('allows an already opened empty timeline to clear the native scene', () => {
    expect(
      isNativeMonitorSceneReady({
        currentProjectName: 'Project',
        currentTimelinePath: 'timelines/Project_001.otio',
        timelineDoc: emptyDoc,
      }),
    ).toBe(true);
  });
});
