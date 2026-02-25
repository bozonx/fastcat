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
      },
    ]);

    const nested = await toWorkerTimelineClips(items, projectStoreMock, { layer: 3 });
    expect(nested[0]?.layer).toBe(3);
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
});
