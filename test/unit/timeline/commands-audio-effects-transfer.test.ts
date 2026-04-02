/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applyTimelineCommand } from '~/timeline/commands';
import type { TimelineDocument, TimelineTrack } from '~/timeline/types';

function makeDoc(): TimelineDocument {
  const videoTrack: TimelineTrack = {
    id: 'v1',
    kind: 'video',
    name: 'Video 1',
    items: [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'clip-1',
        trackId: 'v1',
        name: 'Clip 1',
        source: { path: 'sample.mp4' },
        sourceDurationUs: 10_000_000,
        timelineRange: { startUs: 0, durationUs: 3_000_000 },
        sourceRange: { startUs: 0, durationUs: 3_000_000 },
        effects: [
          {
            id: 'video-blur-1',
            type: 'blur',
            enabled: true,
            strength: 5,
          },
          {
            id: 'audio-reverb-1',
            type: 'audio-reverb',
            enabled: true,
            target: 'audio',
            wet: 0.5,
            decay: 2.5,
            preDelay: 0.01,
          },
        ],
      },
    ],
  };

  const audioTrack: TimelineTrack = {
    id: 'a1',
    kind: 'audio',
    name: 'Audio 1',
    items: [],
  };

  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc-1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [videoTrack, audioTrack],
  };
}

describe('timeline/commands audio effects transfer', () => {
  it('moves audio effects from video clip to extracted audio clip', () => {
    const doc = makeDoc();

    const next = applyTimelineCommand(doc, {
      type: 'extract_audio_to_track',
      videoTrackId: 'v1',
      videoItemId: 'clip-1',
      audioTrackId: 'a1',
    }).next;

    const videoTrack = next.tracks.find((track: TimelineTrack) => track.id === 'v1');
    const audioTrack = next.tracks.find((track: TimelineTrack) => track.id === 'a1');
    const videoClip = videoTrack?.items[0];
    const audioClip = audioTrack?.items[0];

    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioFromVideoDisabled : false).toBe(
      true,
    );
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.effects : []).toEqual([
      {
        id: 'video-blur-1',
        type: 'blur',
        enabled: true,
        strength: 5,
      },
    ]);
    expect(audioClip && audioClip.kind === 'clip' ? audioClip.effects : []).toEqual([
      {
        id: 'audio-reverb-1',
        type: 'audio-reverb',
        enabled: true,
        target: 'audio',
        wet: 0.5,
        decay: 2.5,
        preDelay: 0.01,
      },
    ]);
  });

  it('returns audio effects back to linked video clip', () => {
    let doc = makeDoc();

    doc = applyTimelineCommand(doc, {
      type: 'extract_audio_to_track',
      videoTrackId: 'v1',
      videoItemId: 'clip-1',
      audioTrackId: 'a1',
    }).next;

    const next = applyTimelineCommand(doc, {
      type: 'return_audio_to_video',
      videoItemId: 'clip-1',
    }).next;

    const videoTrack = next.tracks.find((track: TimelineTrack) => track.id === 'v1');
    const audioTrack = next.tracks.find((track: TimelineTrack) => track.id === 'a1');
    const videoClip = videoTrack?.items[0];

    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioFromVideoDisabled : true).toBe(
      false,
    );
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.effects : []).toEqual([
      {
        id: 'video-blur-1',
        type: 'blur',
        enabled: true,
        strength: 5,
      },
      {
        id: 'audio-reverb-1',
        type: 'audio-reverb',
        enabled: true,
        target: 'audio',
        wet: 0.5,
        decay: 2.5,
        preDelay: 0.01,
      },
    ]);
    expect(audioTrack?.items).toHaveLength(0);
  });
});
