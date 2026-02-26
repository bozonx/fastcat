import { describe, it, expect } from 'vitest';
import {
  getExt,
  sanitizeBaseName,
  resolveExportCodecs,
  toWorkerTimelineClips,
} from '../../../../src/composables/timeline/useTimelineExport';
import type { VideoCoreHostAPI } from '../../../../src/utils/video-editor/worker-client';
import type { TimelineTrackItem } from '../../../../src/timeline/types';

describe('useTimelineExport pure functions', () => {
  it('VideoCoreHostAPI allows omitting onExportPhase (backward compatible)', () => {
    const api: VideoCoreHostAPI = {
      getFileHandleByPath: async () => null,
      onExportProgress: () => {},
    };
    expect(typeof api.onExportProgress).toBe('function');
  });

  it('VideoCoreHostAPI allows omitting onExportWarning (backward compatible)', () => {
    const api: VideoCoreHostAPI = {
      getFileHandleByPath: async () => null,
      onExportProgress: () => {},
    };
    expect(typeof api.onExportProgress).toBe('function');
  });

  it('getExt should return correct extension', () => {
    expect(getExt('mp4')).toBe('mp4');
    expect(getExt('webm')).toBe('webm');
    expect(getExt('mkv')).toBe('mkv');
    expect(getExt('unknown' as any)).toBe('mp4');
  });

  it('sanitizeBaseName should sanitize filenames correctly', () => {
    expect(sanitizeBaseName('my video.mp4')).toBe('my_video');
    expect(sanitizeBaseName('special!@#$%^&*()chars')).toBe('special_chars');
    expect(sanitizeBaseName('___leading_and_trailing___')).toBe('leading_and_trailing');
    expect(sanitizeBaseName('multiple___underscores')).toBe('multiple_underscores');
  });

  it('resolveExportCodecs should force codecs for webm and mkv', () => {
    expect(resolveExportCodecs('webm', 'avc1.42E032', 'aac')).toEqual({
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'opus',
    });

    expect(resolveExportCodecs('mkv', 'avc1.42E032', 'aac')).toEqual({
      videoCodec: 'av01.0.05M.08',
      audioCodec: 'opus',
    });

    expect(resolveExportCodecs('mp4', 'avc1.42E032', 'aac')).toEqual({
      videoCodec: 'avc1.42E032',
      audioCodec: 'aac',
    });
  });

  it('toWorkerTimelineClips should attach layer (default 0)', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 't1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: 1_000_000,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
        audioGain: 1.5,
        audioBalance: -0.25,
        audioFadeInUs: 120_000,
        audioFadeOutUs: 340_000,
      },
    ];

    const projectStoreMock = { getFileHandleByPath: async () => null } as any;

    expect(await toWorkerTimelineClips(items, projectStoreMock)).toMatchObject([
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        layer: 0,
        source: { path: '/video.mp4' },
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
        audioGain: 1.5,
        audioBalance: -0.25,
        audioFadeInUs: 120_000,
        audioFadeOutUs: 340_000,
      },
    ]);

    const nested = await toWorkerTimelineClips(items, projectStoreMock, { layer: 3 });
    expect(nested[0]?.layer).toBe(3);
  });

  it('toWorkerTimelineClips should propagate transform', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 't1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: 1_000_000,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      } as any,
    ];

    (items[0] as any).transform = {
      scale: { x: 1.25, y: 0.75, linked: false },
      rotationDeg: 10,
      position: { x: 12, y: -34 },
      anchor: { preset: 'center' },
    };

    const projectStoreMock = { getFileHandleByPath: async () => null } as any;
    const clips = await toWorkerTimelineClips(items, projectStoreMock);

    expect(clips[0]?.transform).toEqual((items[0] as any).transform);
  });

  it('toWorkerTimelineClips should respect item.layer when options.layer is not provided', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 't1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: 1_000_000,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      } as any,
    ];

    (items[0] as any).layer = 5;

    const projectStoreMock = { getFileHandleByPath: async () => null } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock);
    expect(clips[0]?.layer).toBe(5);

    const overridden = await toWorkerTimelineClips(items, projectStoreMock, { layer: 2 });
    expect(overridden[0]?.layer).toBe(2);
  });

  it('toWorkerTimelineClips should resolve relative media paths inside nested timeline', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { gran: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'V1',
            kind: 'Video',
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'Clip',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'media/video.mp4',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                },
                metadata: { gran: { clipType: 'media', sourceDurationUs: 1000000 } },
              },
            ],
          },
        ],
      },
    });

    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'timeline',
        id: 'nested1',
        trackId: 't1',
        name: 'Nested',
        source: { path: 'timelines/nested.otio' } as any,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async (path: string) => {
        if (path !== 'timelines/nested.otio') return null;
        return {
          getFile: async () => ({ text: async () => nestedOtio }),
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, {
      layer: 1,
      trackKind: 'video',
    });

    expect(clips.length).toBe(1);
    expect(clips[0]?.clipType).toBe('media');
    expect(clips[0]?.source?.path).toBe('timelines/media/video.mp4');
  });

  it('toWorkerTimelineClips should apply nested timeline parent audio gain/balance/fades when trackKind is audio', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { gran: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'A1',
            kind: 'Audio',
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'AudioClip',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'audio.wav',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                },
                metadata: {
                  gran: {
                    clipType: 'media',
                    sourceDurationUs: 1000000,
                    audioGain: 2,
                    audioBalance: 0.1,
                    audioFadeInUs: 100000,
                    audioFadeOutUs: 100000,
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'timeline',
        id: 'nested1',
        trackId: 't1',
        name: 'Nested',
        source: { path: 'timelines/nested.otio' } as any,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
        audioGain: 0.5,
        audioBalance: -0.2,
        audioFadeInUs: 200_000,
        audioFadeOutUs: 300_000,
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async (path: string) => {
        if (path !== 'timelines/nested.otio') return null;
        return {
          getFile: async () => ({ text: async () => nestedOtio }),
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, {
      trackKind: 'audio',
    });

    expect(clips.length).toBe(1);
    expect(clips[0]?.source?.path).toBe('timelines/audio.wav');
    expect(clips[0]?.audioGain).toBeCloseTo(1);
    expect(clips[0]?.audioBalance).toBeCloseTo(-0.1);
    expect(clips[0]?.audioFadeInUs).toBe(200_000);
    expect(clips[0]?.audioFadeOutUs).toBe(300_000);
  });
});
