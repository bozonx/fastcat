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
  it('moves audio effects from video clip to extracted audio clip and groups them', () => {
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

    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioMuted : false).toBe(true);
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
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.linkedGroupId : undefined).toBe(
      'clip-1',
    );
    expect(audioClip && audioClip.kind === 'clip' ? audioClip.linkedGroupId : undefined).toBe(
      'clip-1',
    );
  });

  it('rejects extracting audio to an explicitly occupied audio track', () => {
    const doc = makeDoc();
    const audioTrack = doc.tracks.find((track) => track.id === 'a1');
    audioTrack?.items.push({
      kind: 'clip',
      clipType: 'media',
      id: 'existing-audio',
      trackId: 'a1',
      name: 'Existing audio',
      source: { path: 'audio.wav' },
      sourceDurationUs: 10_000_000,
      timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
      sourceRange: { startUs: 0, durationUs: 2_000_000 },
    });

    expect(() =>
      applyTimelineCommand(doc, {
        type: 'extract_audio_to_track',
        videoTrackId: 'v1',
        videoItemId: 'clip-1',
        audioTrackId: 'a1',
      }),
    ).toThrow('Item overlaps with another item');
  });
});
