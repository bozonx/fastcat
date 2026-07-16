import type { TimelineDocument, TimelineTrack } from '~/timeline/types';
import { TimelineBuilder } from '~/timeline/timeline-builder';

export const createEmptyTimelineFixture = (options: { fps?: number } = {}): TimelineDocument => {
  return {
    timebase: { fps: options.fps ?? 30 },
    tracks: [],
    metadata: {
      fastcat: {
        masterGain: 1,
        masterMuted: false,
      },
    },
  };
};

export const createBasicTimelineFixture = (): TimelineDocument => {
  const builder = new TimelineBuilder()
    .withTrack('video', { id: 'v1', name: 'Video 1' }, (track) =>
      track.withClip('media', {
        id: 'clip1',
        sourcePath: '/media/video.mp4',
        startTicks: 0,
        durationTicks: 5_000_000,
      }),
    )
    .withTrack('audio', { id: 'a1', name: 'Audio 1' }, (track) =>
      track.withClip('media', {
        id: 'clip2',
        sourcePath: '/media/audio.wav',
        startTicks: 0,
        durationTicks: 5_000_000,
      }),
    );

  return builder.build();
};

export const createComplexTimelineFixture = (): TimelineDocument => {
  const builder = new TimelineBuilder()
    .withTrack('video', { id: 'v1', name: 'Video 1' }, (track) =>
      track
        .withClip('media', { id: 'c1', sourcePath: '/vid1.mp4', startTicks: 0, durationTicks: 2_000_000 })
        .withClip('media', {
          id: 'c2',
          sourcePath: '/vid2.mp4',
          startTicks: 2_000_000,
          durationTicks: 3_000_000,
        }),
    )
    .withTrack('video', { id: 'v2', name: 'Video 2' }, (track) =>
      track.withClip('text', {
        id: 't1',
        text: 'Hello',
        startTicks: 1_000_000,
        durationTicks: 2_000_000,
      }),
    )
    .withTrack('audio', { id: 'a1', name: 'Audio 1' }, (track) =>
      track.withClip('media', {
        id: 'a_c1',
        sourcePath: '/audio.wav',
        startTicks: 0,
        durationTicks: 5_000_000,
      }),
    );

  return builder.build();
};
