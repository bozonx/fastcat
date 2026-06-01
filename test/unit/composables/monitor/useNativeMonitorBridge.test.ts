import { describe, expect, it } from 'vitest';

import { resolveNativeAudioTrackSelection } from '~/composables/monitor/useNativeMonitorBridge';
import type { TimelineTrack } from '~/timeline/types';

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
