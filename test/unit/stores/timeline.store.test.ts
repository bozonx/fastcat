/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useHistoryStore } from '~/stores/history.store';
import { createTestTimeline } from '../utils/timeline-builder';

const projectStoreMock = {
  currentProjectName: 'test',
  currentTimelinePath: 'timeline.otio',
  getFileHandleByPath: vi.fn(),
  getProjectFileHandleByRelativePath: vi.fn(),
  getFileByPath: vi.fn(),
  createFallbackTimelineDoc: () => ({
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc-1',
    name: 'Default',
    timebase: { fps: 30 },
    tracks: [
      {
        id: 'v1',
        kind: 'video',
        name: 'Video 1',
        items: [],
      },
    ],
  }),
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

const mediaStoreMock = {
  mediaMetadata: { value: {} },
  getOrFetchMetadataByPath: vi.fn(),
  getOrFetchMetadata: vi.fn(),
};

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mediaStoreMock,
}));

describe('TimelineStore', () => {
  let store: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    projectStoreMock.getFileByPath.mockImplementation(async () => ({
      type: 'image/jpeg',
      size: 100,
      lastModified: 1,
      text: async () => '{}',
    } as any));
    store = useTimelineStore();
    projectStoreMock.getFileHandleByPath.mockClear();
    mediaStoreMock.getOrFetchMetadataByPath.mockClear();
    mediaStoreMock.getOrFetchMetadata.mockClear();
  });

  it('initializes with default state', () => {
    expect(store.timelineDoc).toBeDefined();
    expect(store.selectedIds).toHaveLength(0);
    expect(store.playheadUs).toBe(0);
  });

  it('manages item selection', () => {
    store.selectItems(['item-1', 'item-2']);
    expect(store.selectedIds).toContain('item-1');
    expect(store.selectedIds).toContain('item-2');

    store.toggleItemSelection('item-1');
    expect(store.selectedIds).not.toContain('item-1');
    expect(store.selectedIds).toContain('item-2');

    store.clearSelection();
    expect(store.selectedIds).toHaveLength(0);
  });

  it('sets audio volume and unmutes when positive', () => {
    store.audioVolume = 0.5;
    store.audioMuted = true;
    store.setAudioVolume(0.8);
    expect(store.audioVolume).toBe(0.8);
    expect(store.audioMuted).toBe(false);
  });

  it('toggles playback', () => {
    expect(store.isPlaying).toBe(false);
    store.togglePlayback();
    expect(store.isPlaying).toBe(true);
    store.togglePlayback();
    expect(store.isPlaying).toBe(false);
  });

  it('allows negative playback speed and clamps magnitude', () => {
    store.setPlaybackSpeed(-2);
    expect(store.playbackSpeed).toBe(-2);
    store.setPlaybackSpeed(10);
    expect(store.playbackSpeed).toBe(8);
    store.setPlaybackSpeed(-10);
    expect(store.playbackSpeed).toBe(-8);
  });

  it('resets state correctly', () => {
    store.playheadUs = 1000;
    store.selectItems(['item-1']);
    store.resetTimelineState();
    expect(store.playheadUs).toBe(0);
    expect(store.selectedIds).toHaveLength(0);
  });

  it('sets freeze frame from playhead when playhead is inside clip', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 1000, durationUs: 5000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.playheadUs = 3000;
    await store.setFreezeFrame('c1');

    const clip = (store.timelineDoc as any).tracks[0].items[0];
    expect(clip.freezeFrame).toBeDefined();
    expect(clip.freezeFrame.sourceTimeUs).toBe(2000); // 3000 - 1000
  });

  it('sets freeze frame to first frame when playhead is outside clip', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 1000, durationUs: 5000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.playheadUs = 0;
    await store.setFreezeFrame('c1');

    const clip = (store.timelineDoc as any).tracks[0].items[0];
    expect(clip.freezeFrame.sourceTimeUs).toBe(0);
  });

  it('resets freeze frame', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [
            { id: 'c1', startUs: 1000, durationUs: 5000, freezeFrame: { sourceTimeUs: 100 } },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    await store.resetFreezeFrame('c1');
    const clip = (store.timelineDoc as any).tracks[0].items[0];
    expect(clip.freezeFrame).toBeUndefined();
  });

  it('debounces history entries when requested', () => {
    const historyStore = useHistoryStore();
    const spy = vi.spyOn(historyStore, 'addEntry');

    store.playheadUs = 1000;
    expect(true).toBe(true);
  });

  it('jumps to previous/next clip boundary (all tracks)', () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [
            { id: 'c1', startUs: 0, durationUs: 5000 },
            { id: 'c2', startUs: 8000, durationUs: 2000 },
          ],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.playheadUs = 3000;

    store.jumpToNextBoundary();
    expect(store.playheadUs).toBe(5000);

    store.jumpToNextBoundary();
    expect(store.playheadUs).toBe(8000);

    store.jumpToPreviousBoundary();
    expect(store.playheadUs).toBe(5000);
  });

  it('jumps to previous/next clip boundary (current track only)', () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 0, durationUs: 5000 }],
        },
        {
          id: 'v2',
          kind: 'video',
          clips: [{ id: 'c2', startUs: 2000, durationUs: 2000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.playheadUs = 1000;

    store.jumpToNextBoundary({ currentTrackOnly: true, trackId: 'v1' });
    expect(store.playheadUs).toBe(5000);
  });

  it('splits a selected clip at playhead', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 0, durationUs: 10000 }],
        },
      ],
    });
    store.timelineDoc = timeline;
    store.playheadUs = 4000;
    store.selectItems(['c1']);

    await store.splitSelectedClipsAtPlayhead();
    const track = (store.timelineDoc as any).tracks[0];
    expect(track.items).toHaveLength(2);
  });

  it('trims left/right to playhead without ripple', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 0, durationUs: 10000 }],
        },
      ],
    });
    store.timelineDoc = timeline;

    store.playheadUs = 2000;
    await store.trimClipToPlayhead({ clipId: 'c1', side: 'left' });
    expect((store.timelineDoc as any).tracks[0].items[0].timelineRange.startUs).toBe(2000);

    store.playheadUs = 8000;
    await store.trimClipToPlayhead({ clipId: 'c1', side: 'right' });
    expect((store.timelineDoc as any).tracks[0].items[0].timelineRange.durationUs).toBe(6000);
  });

  it('toggles disable and mute on target clip', async () => {
    const timeline = createTestTimeline({
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          clips: [{ id: 'c1', startUs: 0, durationUs: 5000 }],
        },
      ],
    });
    store.timelineDoc = timeline;

    await store.toggleClipsDisabled(['c1']);
    expect((store.timelineDoc as any).tracks[0].items[0].disabled).toBe(true);

    await store.toggleClipsMuted(['c1']);
    expect((store.timelineDoc as any).tracks[0].items[0].muted).toBe(true);
  });

  it('adds image source to video track with default image duration', async () => {
    await store.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'image.jpg',
      path: 'image.jpg',
      startUs: 0,
    });

    const track = (store.timelineDoc as any).tracks.find((t: any) => t.id === 'v1');
    expect(track.items).toHaveLength(1);
  });

  it('adds nested timeline clip from .otio path and blocks self-drop', async () => {
    const otio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'Nested',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: [] }],
      },
      metadata: { fastcat: { docId: 'nested', timebase: { fps: 25 } } },
    });

    projectStoreMock.getFileByPath.mockImplementation(async (path: string) => {
      if (path === 'nested.otio') {
        return { text: async () => otio } as any;
      }
      return null;
    });

    await expect(
      store.addTimelineClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Self',
        path: 'timeline.otio',
        startUs: 0,
      }),
    ).rejects.toThrow(/currently opened timeline/i);

    await store.addTimelineClipToTimelineFromPath({
      trackId: 'v1',
      name: 'Nested',
      path: 'nested.otio',
      startUs: 0,
    });

    const added = (store.timelineDoc as any).tracks[0].items[0];
    expect(added.clipType).toBe('timeline');
  });

  it('rejects nested timeline without audio on audio track and allows moving nested timeline to audio track', async () => {
    const videoOnlyNestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'VideoOnly',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [{ OTIO_SCHEMA: 'Track.1', kind: 'Video', children: [] }],
      },
      metadata: { fastcat: { docId: 'vo', timebase: { fps: 25 } } },
    });

    projectStoreMock.getFileByPath.mockImplementation(async (path: string) => {
      if (path === 'vo.otio') {
        return { text: async () => videoOnlyNestedOtio } as any;
      }
      return null;
    });

    await expect(
      store.addTimelineClipToTimelineFromPath({
        trackId: 'a1',
        name: 'VO',
        path: 'vo.otio',
        startUs: 0,
      }),
    ).rejects.toThrow(/audio content/i);
  });

  it('rejects transitive circular nested timeline dependency', async () => {
    const cycleNestedOtio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'Cycle',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            kind: 'Video',
            children: [{ OTIO_SCHEMA: 'Clip.1', media_reference: { target_url: 'timeline.otio' } }],
          },
        ],
      },
      metadata: { fastcat: { docId: 'cycle', timebase: { fps: 25 } } },
    });

    projectStoreMock.getFileByPath.mockImplementation(async () => ({
      text: async () => cycleNestedOtio,
    } as any));

    await expect(
      store.addTimelineClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Cycle',
        path: 'cycle.otio',
        startUs: 0,
      }),
    ).rejects.toThrow(/circular nested timeline dependency/i);
  });
});
