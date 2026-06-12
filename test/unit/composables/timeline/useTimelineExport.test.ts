/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildVideoWorkerPayloadFromTracks,
  buildVideoWorkerPayload,
  getExt,
  sanitizeBaseName,
  normalizeExportFilename,
  hasInvalidExportFilenameChars,
  resolveNextAvailableFilename,
  resolveExportCodecs,
  supportsExportAlpha,
  toWorkerTimelineClips,
  trimWorkerClipToRange,
  clearNestedDocCacheForTests,
} from '~/composables/timeline/export';
import type { VideoCoreHostAPI } from '~/utils/video-editor/worker-client';
import type { TimelineTrackItem } from '~/timeline/types';

describe('useTimelineExport pure functions', () => {
  const wsMock: any = { userSettings: { projectDefaults: { defaultAudioFadeCurve: 'linear' } } };

  beforeEach(() => {
    clearNestedDocCacheForTests();
  });

  it('VideoCoreHostAPI allows omitting onExportPhase (backward compatible)', () => {
    const api: VideoCoreHostAPI = {
      getCurrentProjectId: async () => null,
      getFileHandleByPath: async () => null,
      ensureVectorImageRaster: async () => null,
      onExportProgress: () => {},
    };
    expect(typeof api.onExportProgress).toBe('function');
  });

  it('VideoCoreHostAPI allows omitting onExportWarning (backward compatible)', () => {
    const api: VideoCoreHostAPI = {
      getCurrentProjectId: async () => null,
      getFileHandleByPath: async () => null,
      ensureVectorImageRaster: async () => null,
      onExportProgress: () => {},
    };
    expect(typeof api.onExportProgress).toBe('function');
  });

  it('getExt should return correct extension', () => {
    expect(getExt('mp4')).toBe('mp4');
    expect(getExt('webm')).toBe('webm');
    expect(getExt('mkv')).toBe('mkv');
    expect(getExt('mp3')).toBe('mp3');
    expect(getExt('unknown' as any)).toBe('mp4');
  });

  it('sanitizeBaseName should sanitize filenames correctly', () => {
    expect(sanitizeBaseName('my video.mp4')).toBe('my_video');
    expect(sanitizeBaseName('special!@#$%^&*()chars')).toBe('special_chars');
    expect(sanitizeBaseName('___leading_and_trailing___')).toBe('leading_and_trailing');
    expect(sanitizeBaseName('multiple___underscores')).toBe('multiple_underscores');
    expect(sanitizeBaseName('русское видео 123.mp4')).toBe('русское_видео_123');
    expect(sanitizeBaseName('CON')).toBe('CON_');
    expect(sanitizeBaseName('NUL.mp4')).toBe('NUL_');
  });

  it('normalizes and validates export filenames', () => {
    expect(normalizeExportFilename('  video.mp4  ')).toBe('video.mp4');
    expect(hasInvalidExportFilenameChars('nested/video.mp4')).toBe(true);
    expect(hasInvalidExportFilenameChars('nested\\video.mp4')).toBe(true);
    expect(hasInvalidExportFilenameChars('video?.mp4')).toBe(true);
    expect(hasInvalidExportFilenameChars('video*.mp4')).toBe(true);
    expect(hasInvalidExportFilenameChars('video:1.mp4')).toBe(true);
    expect(hasInvalidExportFilenameChars('video.mp4')).toBe(false);
  });

  it('resolveNextAvailableFilename should prefer base.ext and fallback to _001', () => {
    expect(resolveNextAvailableFilename(new Set(), 'video', 'mp4')).toBe('video.mp4');
    expect(resolveNextAvailableFilename(new Set(['video.mp4']), 'video', 'mp4')).toBe(
      'video_001.mp4',
    );
    expect(
      resolveNextAvailableFilename(new Set(['video.mp4', 'video_001.mp4']), 'video', '.mp4'),
    ).toBe('video_002.mp4');
  });

  it('resolveExportCodecs should force codecs for webm and mkv', () => {
    expect(resolveExportCodecs('webm', 'avc1.640032', 'aac')).toEqual({
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'opus',
    });

    expect(resolveExportCodecs('mkv', 'avc1.640032', 'aac')).toEqual({
      videoCodec: 'avc1.640032',
      audioCodec: 'aac',
    });

    expect(resolveExportCodecs('mkv', 'vp09.00.10.08', 'aac')).toEqual({
      videoCodec: 'vp09.00.10.08',
      audioCodec: 'aac',
    });

    expect(resolveExportCodecs('mkv', 'unsupported', 'aac')).toEqual({
      videoCodec: 'av01.0.05M.08',
      audioCodec: 'aac',
    });

    expect(resolveExportCodecs('mp4', 'avc1.640032', 'aac')).toEqual({
      videoCodec: 'avc1.640032',
      audioCodec: 'aac',
    });

    expect(resolveExportCodecs('mp4', 'av01.0.05M.08', 'aac')).toEqual({
      videoCodec: 'avc1.640032',
      audioCodec: 'aac',
    });

    expect(resolveExportCodecs('mp4', 'unsupported', 'aac')).toEqual({
      videoCodec: 'avc1.640032',
      audioCodec: 'aac',
    });
  });

  it('supportsExportAlpha should only allow webm exports and mkv with alpha-capable codecs', () => {
    expect(supportsExportAlpha('webm')).toBe(true);
    expect(supportsExportAlpha('mp4')).toBe(false);
    expect(supportsExportAlpha('mkv')).toBe(false);
    expect(supportsExportAlpha('mkv', 'av01.0.05M.08')).toBe(true);
    expect(supportsExportAlpha('mkv', 'vp09.00.10.08')).toBe(true);
    expect(supportsExportAlpha('mkv', 'avc1.640032')).toBe(false);
  });

  it('buildVideoWorkerPayload should emit meta, track and clip items', () => {
    const payload = buildVideoWorkerPayload({
      masterEffects: [{ id: 'master-1', type: 'blur', enabled: true, amount: 4 } as any],
      tracks: [
        {
          id: 'v1',
          layer: 2,
          opacity: 0.6,
          blendMode: 'screen',
          effects: [{ id: 'track-1', type: 'blur', enabled: true, amount: 2 } as any],
        },
      ],
      clips: [
        {
          kind: 'clip',
          clipType: 'media',
          id: 'c1',
          trackId: 'v1',
          layer: 2,
          source: { path: '/video.mp4' },
          timelineRange: { startUs: 0, durationUs: 1_000_000 },
          sourceRange: { startUs: 0, durationUs: 1_000_000 },
        },
      ],
    });

    expect(payload).toMatchObject([
      { kind: 'meta' },
      {
        kind: 'track',
        id: 'v1',
        layer: 2,
        opacity: 0.6,
        blendMode: 'screen',
      },
      {
        kind: 'clip',
        id: 'c1',
        trackId: 'v1',
        layer: 2,
      },
    ]);
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

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    expect(await toWorkerTimelineClips(items, projectStoreMock, wsMock)).toMatchObject([
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

    const nested = await toWorkerTimelineClips(items, projectStoreMock, wsMock, { layer: 3 });
    expect(nested[0]?.layer).toBe(3);
  });

  it('serializes HUD frame and masks into video worker payloads', async () => {
    const tracks = [
      {
        id: 'v1',
        kind: 'video',
        items: [
          {
            kind: 'clip',
            clipType: 'hud',
            id: 'hud-1',
            trackId: 'v1',
            name: 'HUD',
            hudType: 'media_frame',
            background: { source: { path: '/background.png' } },
            content: { source: { path: '/content.mp4' } },
            frame: { source: { path: '/frame.png' }, scaleX: 1.5 },
            mask: { source: { path: '/mask.png' }, mode: 'alpha' },
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          },
        ],
      },
    ] as any;
    const projectStoreMock = {
      getFileByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const built = await buildVideoWorkerPayloadFromTracks({
      tracks,
      projectStore: projectStoreMock,
      workspaceStore: wsMock,
    });

    expect(built.clips[0]).toMatchObject({
      clipType: 'hud',
      frame: { source: { path: '/frame.png' }, scaleX: 1.5 },
      mask: { source: { path: '/mask.png' }, mode: 'alpha' },
    });

    const legacy = await toWorkerTimelineClips(tracks[0].items, projectStoreMock, wsMock);
    expect(legacy[0]).toMatchObject({
      clipType: 'hud',
      frame: { source: { path: '/frame.png' }, scaleX: 1.5 },
      mask: { source: { path: '/mask.png' }, mode: 'alpha' },
    });
  });

  it('trimWorkerClipToRange should preserve fade progress when cropping export range', () => {
    const clipped = trimWorkerClipToRange(
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        layer: 0,
        source: { path: '/audio.wav' },
        audioFadeInUs: 300_000,
        audioFadeOutUs: 400_000,
        timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
        sourceRange: { startUs: 2_000_000, durationUs: 1_000_000 },
      },
      { startUs: 1_200_000, endUs: 1_800_000 },
    );

    expect(clipped).toMatchObject({
      audioFadeInUs: 100_000,
      audioFadeOutUs: 200_000,
      timelineRange: { startUs: 0, durationUs: 600_000 },
      sourceRange: { startUs: 2_200_000, durationUs: 600_000 },
    });
  });

  it('trimWorkerClipToRange should scale source crop by speed and trim reversed clips from the source tail', () => {
    const forward = trimWorkerClipToRange(
      {
        kind: 'clip',
        clipType: 'media',
        id: 'fast',
        layer: 0,
        speed: 2,
        source: { path: '/video.mp4' },
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 2_000_000, durationUs: 2_000_000 },
      },
      { startUs: 250_000, endUs: 750_000 },
    );
    expect(forward?.sourceRange).toEqual({ startUs: 2_500_000, durationUs: 1_000_000 });

    const reversed = trimWorkerClipToRange(
      {
        kind: 'clip',
        clipType: 'media',
        id: 'reverse',
        layer: 0,
        speed: -1,
        source: { path: '/video.mp4' },
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 2_000_000, durationUs: 1_000_000 },
      },
      { startUs: 250_000, endUs: 750_000 },
    );
    expect(reversed?.sourceRange).toEqual({ startUs: 2_250_000, durationUs: 500_000 });
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

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;
    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);

    expect(clips[0]?.transform).toEqual((items[0] as any).transform);
  });

  it('toWorkerTimelineClips should keep top-level clip compositing separate from track compositing', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'media',
        id: 'c1',
        trackId: 'v1',
        name: 'Clip 1',
        source: { path: '/video.mp4' },
        sourceDurationUs: 1_000_000,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
        opacity: 0.5,
        blendMode: 'multiply',
        effects: [{ id: 'clip-1', type: 'blur', enabled: true, amount: 1 } as any],
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;
    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      layer: 3,
      trackKind: 'video',
    });

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      id: 'c1',
      trackId: 'v1',
      layer: 3,
      opacity: 0.5,
      blendMode: 'multiply',
    });
    expect(clips[0]?.effects).toEqual([{ id: 'clip-1', type: 'blur', enabled: true, amount: 1 }]);
  });

  it('toWorkerTimelineClips should normalize background clip colors', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'background',
        id: 'bg1',
        trackId: 't1',
        name: 'Background',
        backgroundColor: 'abc',
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      clipType: 'background',
      backgroundColor: '#aabbcc',
    });
  });

  it('buildVideoWorkerPayloadFromTracks should preserve multiple adjustment clips', async () => {
    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const workspaceStoreMock = {
      userSettings: {
        projectDefaults: { audioDeclickDurationUs: 5000 },
        optimization: { videoFrameCacheMb: 256 },
      },
    } as any;

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              kind: 'clip',
              clipType: 'adjustment',
              id: 'adj-1',
              trackId: 'v1',
              name: 'Adjustment 1',
              effects: [{ id: 'fx-1', type: 'blur', enabled: true, amount: 2 }],
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        } as any,
        {
          id: 'v2',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              kind: 'clip',
              clipType: 'adjustment',
              id: 'adj-2',
              trackId: 'v2',
              name: 'Adjustment 2',
              effects: [{ id: 'fx-2', type: 'color-adjustment', enabled: true, brightness: 1 }],
              timelineRange: { startUs: 250_000, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        } as any,
      ],
      projectStore: projectStoreMock,
      workspaceStore: workspaceStoreMock,
    });

    expect(result.clips.filter((clip) => clip.clipType === 'adjustment')).toHaveLength(2);
    expect(
      result.payload.filter((item) => item.kind === 'clip' && item.clipType === 'adjustment'),
    ).toHaveLength(2);
  });

  it('toWorkerTimelineClips should preserve transitions on background clips', async () => {
    const items: TimelineTrackItem[] = [
      {
        kind: 'clip',
        clipType: 'background',
        id: 'bg1',
        trackId: 't1',
        name: 'Background',
        backgroundColor: '#112233',
        transitionIn: {
          type: 'fade-to-black',
          durationUs: 250_000,
          mode: 'background',
          curve: 'linear',
          params: {},
        },
        transitionOut: {
          type: 'dissolve',
          durationUs: 250_000,
          mode: 'transparent',
          curve: 'linear',
          params: {},
        },
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      } as any,
    ];

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);

    expect(clips[0]).toMatchObject({
      clipType: 'background',
      transitionIn: {
        type: 'fade-to-black',
        durationUs: 250_000,
        mode: 'background',
      },
      transitionOut: {
        type: 'dissolve',
        durationUs: 250_000,
        mode: 'transparent',
      },
    });
  });

  it('buildVideoWorkerPayloadFromTracks should preserve transition data on adjustment clips', async () => {
    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const workspaceStoreMock = {
      userSettings: {
        projectDefaults: { audioDeclickDurationUs: 5000 },
        optimization: { videoFrameCacheMb: 256 },
      },
    } as any;

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: false,
          items: [
            {
              kind: 'clip',
              clipType: 'adjustment',
              id: 'adj-1',
              trackId: 'v1',
              name: 'Adjustment 1',
              transitionIn: {
                type: 'fade-to-black',
                durationUs: 300_000,
                mode: 'background',
                curve: 'linear',
                params: {},
              },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        } as any,
      ],
      projectStore: projectStoreMock,
      workspaceStore: workspaceStoreMock,
    });

    expect(result.clips[0]).toMatchObject({
      clipType: 'adjustment',
      transitionIn: {
        type: 'fade-to-black',
        durationUs: 300_000,
        mode: 'background',
      },
    });
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

    const projectStoreMock = {
      getFileHandleByPath: async () => null,
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock);
    expect(clips[0]?.layer).toBe(5);

    const overridden = await toWorkerTimelineClips(items, projectStoreMock, wsMock, { layer: 2 });
    expect(overridden[0]?.layer).toBe(2);
  });

  it('toWorkerTimelineClips should resolve relative media paths inside nested timeline', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
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
                metadata: {
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 1000000 },
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
        source: { path: '_timelines/nested.otio' } as any,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
      } as any,
    ];

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      layer: 1,
      trackKind: 'video',
    });

    expect(clips.length).toBe(1);
    expect(clips[0]?.clipType).toBe('media');
    expect(clips[0]?.source?.path).toBe('_timelines/media/video.mp4');
    expect(clips[0]?.trackId).toBe('t1::nested1::v1');
  });

  it('toWorkerTimelineClips should map parent nested timeline speed into child clips', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
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
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 2000000, rate: 1000000 },
                },
                metadata: {
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 2000000 },
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
        id: 'nested-fast',
        trackId: 't1',
        name: 'Nested Fast',
        source: { path: '_timelines/nested.otio' } as any,
        speed: 2,
        timelineRange: { startUs: 5_000_000, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 2_000_000 },
      } as any,
    ];

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      layer: 1,
      trackKind: 'video',
    });

    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({
      speed: 2,
      timelineRange: { startUs: 5_000_000, durationUs: 1_000_000 },
      sourceRange: { startUs: 0, durationUs: 2_000_000 },
    });
  });

  it('toWorkerTimelineClips should stop circular nested timelines after resolving relative paths', async () => {
    const makeNestedOtio = (targetUrl: string) =>
      JSON.stringify({
        OTIO_SCHEMA: 'Timeline.1',
        name: 'nested',
        metadata: { fastcat: { timebase: { fps: 25 } } },
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
                  name: 'Nested',
                  media_reference: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: targetUrl,
                  },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                  },
                  metadata: {
                    fastcat: {
                      clipType: 'timeline',
                      source: { durationUs: 1000000 },
                    },
                  },
                },
              ],
            },
          ],
        },
      });

    const requestedPaths: string[] = [];
    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        requestedPaths.push(path);
        if (path === '_timelines/sub/a.otio') {
          return { text: async () => makeNestedOtio('../root.otio') } as any;
        }
        if (path === '_timelines/root.otio') {
          return { text: async () => makeNestedOtio('sub/./a.otio') } as any;
        }
        return null;
      },
    } as any;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const clips = await toWorkerTimelineClips(
        [
          {
            kind: 'clip',
            clipType: 'timeline',
            id: 'nested-a',
            trackId: 't1',
            name: 'Nested A',
            source: { path: '_timelines/sub/../sub/a.otio' },
            timelineRange: { startUs: 0, durationUs: 1_000_000 },
            sourceRange: { startUs: 0, durationUs: 1_000_000 },
          } as any,
        ],
        projectStoreMock,
        wsMock,
        { layer: 1, trackKind: 'video' },
      );

      expect(clips).toEqual([]);
      expect(requestedPaths).toEqual(['_timelines/sub/a.otio', '_timelines/root.otio']);
      expect(warnSpy).toHaveBeenCalledWith(
        '[payloadBuilder]',
        expect.stringContaining('Circular dependency in nested timeline'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('buildVideoWorkerPayloadFromTracks should emit explicit nested track payload items', async () => {
    const workspaceStoreMock = {
      userSettings: {
        projectDefaults: { audioDeclickDurationUs: 5000 },
        optimization: { videoFrameCacheMb: 256 },
      },
    } as any;

    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        name: 'tracks',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            name: 'NestedV1',
            kind: 'Video',
            metadata: {
              fastcat: {
                video: {
                  opacity: 0.4,
                  blendMode: 'screen',
                },
              },
            },
            children: [
              {
                OTIO_SCHEMA: 'Clip.1',
                name: 'NestedClip',
                media_reference: {
                  OTIO_SCHEMA: 'ExternalReference.1',
                  target_url: 'media/video.mp4',
                },
                source_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 1000000, rate: 1000000 },
                },
                metadata: {
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 1000000 },
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const result = await buildVideoWorkerPayloadFromTracks({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          videoHidden: false,
          opacity: 0.5,
          blendMode: 'multiply',
          items: [
            {
              kind: 'clip',
              clipType: 'timeline',
              id: 'nested-1',
              trackId: 'v1',
              name: 'Nested',
              source: { path: '_timelines/nested.otio' },
              timelineRange: { startUs: 0, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        } as any,
      ],
      projectStore: projectStoreMock,
      workspaceStore: workspaceStoreMock,
    });

    expect(result.tracks).toEqual([
      expect.objectContaining({ id: 'v1', layer: 0, opacity: 0.5, blendMode: 'multiply' }),
      expect.objectContaining({
        id: 'v1::nested-1::v1',
        layer: 0,
        opacity: 0.2,
        blendMode: 'screen',
      }),
    ]);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0]?.id.startsWith('nested-1_nested_')).toBe(true);
    expect(result.clips[0]).toMatchObject({
      trackId: 'v1::nested-1::v1',
      source: { path: '_timelines/media/video.mp4' },
    });
    expect(result.payload.filter((item) => item.kind === 'track')).toHaveLength(2);
  });

  it('toWorkerTimelineClips should apply nested timeline parent audio gain/balance/fades when trackKind is audio', async () => {
    const nestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'nested',
      metadata: { fastcat: { timebase: { fps: 25 } } },
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
                  fastcat: {
                    clipType: 'media',
                    source: { durationUs: 1000000 },
                    audio: {
                      gain: 2,
                      balance: 0.1,
                      fadeInUs: 100000,
                      fadeOutUs: 100000,
                    },
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
        source: { path: '_timelines/nested.otio' } as any,
        timelineRange: { startUs: 0, durationUs: 1_000_000 },
        sourceRange: { startUs: 0, durationUs: 1_000_000 },
        audioGain: 0.5,
        audioBalance: -0.2,
        audioFadeInUs: 200_000,
        audioFadeOutUs: 300_000,
      } as any,
    ];

    const projectStoreMock = {
      projectSettings: { project: { audioDeclickDurationUs: 5000 } },
      getFileByPath: async (path: string) => {
        if (path !== '_timelines/nested.otio') return null;
        return {
          text: async () => nestedOtio,
        } as any;
      },
    } as any;

    const clips = await toWorkerTimelineClips(items, projectStoreMock, wsMock, {
      trackKind: 'audio',
    });

    expect(clips.length).toBe(1);
    expect(clips[0]?.source?.path).toBe('_timelines/audio.wav');
    expect(clips[0]?.audioGain).toBeCloseTo(1);
    expect(clips[0]?.audioBalance).toBeCloseTo(-0.1);
    expect(clips[0]?.audioFadeInUs).toBe(200_000);
    expect(clips[0]?.audioFadeOutUs).toBe(300_000);
  });
});
