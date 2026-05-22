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
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.linkedGroupId : undefined).toBe(
      'clip-1',
    );
    expect(audioClip && audioClip.kind === 'clip' ? audioClip.linkedGroupId : undefined).toBe(
      'clip-1',
    );
    expect(audioClip && audioClip.kind === 'clip' ? audioClip.linkedVideoClipId : undefined).toBe(
      'clip-1',
    );
    expect(audioClip && audioClip.kind === 'clip' ? audioClip.lockToLinkedVideo : false).toBe(true);
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

  it('returns audio clip properties back to video clip', () => {
    let doc = makeDoc();

    doc = applyTimelineCommand(doc, {
      type: 'extract_audio_to_track',
      videoTrackId: 'v1',
      videoItemId: 'clip-1',
      audioTrackId: 'a1',
    }).next;

    const audioClip = doc.tracks
      .find((track) => track.id === 'a1')
      ?.items.find((item) => item.kind === 'clip');
    expect(audioClip).toBeDefined();

    doc = applyTimelineCommand(doc, {
      type: 'update_clip_properties',
      trackId: 'a1',
      itemId: audioClip!.id,
      properties: {
        audioGain: 0.45,
        audioBalance: -0.25,
        audioFadeInUs: 100_000,
        audioFadeOutUs: 200_000,
        audioFadeInCurve: 'logarithmic',
        audioFadeOutCurve: 'linear',
        audioMuted: true,
        audioWaveformMode: 'half',
        showWaveform: false,
      },
    }).next;

    const next = applyTimelineCommand(doc, {
      type: 'return_audio_to_video',
      videoItemId: 'clip-1',
    }).next;

    const videoClip = next.tracks
      .find((track) => track.id === 'v1')
      ?.items.find((item) => item.kind === 'clip');

    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioGain : undefined).toBe(0.45);
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioBalance : undefined).toBe(-0.25);
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioFadeInUs : undefined).toBe(
      100_000,
    );
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioFadeOutUs : undefined).toBe(
      200_000,
    );
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioFadeInCurve : undefined).toBe(
      'logarithmic',
    );
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioMuted : undefined).toBe(true);
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.audioWaveformMode : undefined).toBe(
      'half',
    );
    expect(videoClip && videoClip.kind === 'clip' ? videoClip.showWaveform : undefined).toBe(false);
  });

  it('fully unlinks extracted audio from the extraction-created group', () => {
    let doc = makeDoc();

    doc = applyTimelineCommand(doc, {
      type: 'extract_audio_to_track',
      videoTrackId: 'v1',
      videoItemId: 'clip-1',
      audioTrackId: 'a1',
    }).next;

    const audioClip = doc.tracks
      .find((track) => track.id === 'a1')
      ?.items.find((item) => item.kind === 'clip');

    const next = applyTimelineCommand(doc, {
      type: 'unlink_audio_from_video',
      audioTrackId: 'a1',
      audioItemId: audioClip!.id,
    }).next;

    const videoClip = next.tracks
      .find((track) => track.id === 'v1')
      ?.items.find((item) => item.kind === 'clip');
    const unlinkedAudioClip = next.tracks
      .find((track) => track.id === 'a1')
      ?.items.find((item) => item.kind === 'clip');

    expect(videoClip && videoClip.kind === 'clip' ? videoClip.linkedGroupId : undefined).toBe(
      undefined,
    );
    expect(
      unlinkedAudioClip && unlinkedAudioClip.kind === 'clip'
        ? unlinkedAudioClip.linkedVideoClipId
        : undefined,
    ).toBe(undefined);
    expect(
      unlinkedAudioClip && unlinkedAudioClip.kind === 'clip'
        ? unlinkedAudioClip.lockToLinkedVideo
        : undefined,
    ).toBe(false);
    expect(
      unlinkedAudioClip && unlinkedAudioClip.kind === 'clip'
        ? unlinkedAudioClip.linkedGroupId
        : undefined,
    ).toBe(undefined);
  });

  it('keeps a pre-existing video group when unlinking extracted audio', () => {
    let doc = makeDoc();
    const videoClip = doc.tracks[0].items[0];
    if (videoClip?.kind === 'clip') {
      videoClip.linkedGroupId = 'manual-group';
    }

    doc = applyTimelineCommand(doc, {
      type: 'extract_audio_to_track',
      videoTrackId: 'v1',
      videoItemId: 'clip-1',
      audioTrackId: 'a1',
    }).next;

    const audioClip = doc.tracks
      .find((track) => track.id === 'a1')
      ?.items.find((item) => item.kind === 'clip');

    const next = applyTimelineCommand(doc, {
      type: 'unlink_audio_from_video',
      videoItemId: 'clip-1',
    }).next;

    const nextVideoClip = next.tracks
      .find((track) => track.id === 'v1')
      ?.items.find((item) => item.kind === 'clip');
    const nextAudioClip = next.tracks
      .find((track) => track.id === 'a1')
      ?.items.find((item) => item.id === audioClip!.id);

    expect(nextVideoClip && nextVideoClip.kind === 'clip' ? nextVideoClip.linkedGroupId : '').toBe(
      'manual-group',
    );
    expect(nextAudioClip && nextAudioClip.kind === 'clip' ? nextAudioClip.linkedGroupId : '').toBe(
      undefined,
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
