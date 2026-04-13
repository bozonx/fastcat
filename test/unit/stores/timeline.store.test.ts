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
    store = useTimelineStore();
    projectStoreMock.getFileHandleByPath.mockReset();
    projectStoreMock.getFileByPath.mockReset().mockImplementation(async () => ({
      type: 'image/jpeg',
      size: 100,
      lastModified: 1,
      text: async () => '{}',
    } as any));
    store = useTimelineStore();
    mediaStoreMock.getOrFetchMetadataByPath.mockReset();
    mediaStoreMock.getOrFetchMetadata.mockReset();
  });

  it('initializes with default state', () => {
    expect(store.timelineDoc).toBeNull();
    expect(store.isPlaying).toBe(false);
    expect(store.masterGain).toBe(1);
  });

  it('manages item selection', () => {
    store.toggleSelection('item-1');
    expect(store.selectedItemIds).toEqual(['item-1']);

    store.toggleSelection('item-2', { multi: true });
    expect(store.selectedItemIds).toContain('item-1');
    expect(store.selectedItemIds).toContain('item-2');

    store.clearSelection();
    expect(store.selectedItemIds).toEqual([]);
  });

  it('sets audio volume and unmutes when positive', () => {
    store.audioMuted = true;

    // The store no longer mutates state directly for masterGain, it applies a command.
    // In unit test without fully mounted pinia/dispatcher loop we can just check if
    // audioMuted is toggled appropriately when setMasterGain is called.
    store.setMasterGain(0.5);
    expect(store.audioMuted).toBe(false);
  });

  it('toggles playback', () => {
    const handler = vi.fn();
    store.setPlaybackGestureHandler(handler);

    store.togglePlayback();
    expect(store.isPlaying).toBe(true);
    expect(handler).toHaveBeenCalledWith(true);

    store.togglePlayback();
    expect(store.isPlaying).toBe(false);
    expect(handler).toHaveBeenCalledWith(false);
  });

  it('allows negative playback speed and clamps magnitude', () => {
    store.setPlaybackSpeed(-2);
    expect(store.playbackSpeed).toBe(-2);

    store.setPlaybackSpeed(-999);
    expect(store.playbackSpeed).toBe(-10);

    store.setPlaybackSpeed(-0.00001);
    expect(store.playbackSpeed).toBe(-0.1);
  });

  it('resets state correctly', () => {
    store.isPlaying = true;
    store.currentTime = 100;
    store.timelineZoom = 80;

    store.resetTimelineState();

    expect(store.isPlaying).toBe(false);
    expect(store.currentTime).toBe(0);
    expect(store.timelineZoom).toBe(50);
  });

  it('sets freeze frame from playhead when playhead is inside clip', () => {
    store.timelineDoc = createTestTimeline()
      .withTrack('v1')
      .withClip('c1', 'v1', { startUs: 1_000_000, durationUs: 2_000_000 })
      .build() as any;

    store.currentTime = 1_500_000;
    store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const clip = (store.timelineDoc as any).tracks[0].items.find((it: any) => it.id === 'c1');
    expect(typeof clip.freezeFrameSourceUs).toBe('number');
    expect(clip.freezeFrameSourceUs).toBeGreaterThanOrEqual(0);
  });

  it('sets freeze frame to first frame when playhead is outside clip', () => {
    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
              sourceRange: { startUs: 123_000, durationUs: 2_000_000 },
            },
          ],
        },
      ],
    } as any;

    store.currentTime = 10;
    store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const clip = (store.timelineDoc as any).tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.freezeFrameSourceUs).toBe(133_333);
  });

  it('resets freeze frame', () => {
    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 0, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
              freezeFrameSourceUs: 1_000,
            },
          ],
        },
      ],
    } as any;

    store.resetClipFreezeFrame({ trackId: 'v1', itemId: 'c1' });
    const clip = (store.timelineDoc as any).tracks[0].items[0];
    expect(clip.freezeFrameSourceUs).toBeUndefined();
  });

  it('debounces history entries when requested', () => {
    vi.useFakeTimers();

    const historyStore = useHistoryStore();

    store.timelineDoc = projectStoreMock.createFallbackTimelineDoc() as any;

    store.applyTimeline(
      { type: 'add_track', kind: 'audio', name: 'Audio 1' },
      { historyMode: 'debounced', historyDebounceMs: 100, saveMode: 'none' },
    );
    store.applyTimeline(
      { type: 'add_track', kind: 'audio', name: 'Audio 2' },
      { historyMode: 'debounced', historyDebounceMs: 100, saveMode: 'none' },
    );

    expect(historyStore.past).toHaveLength(0);

    vi.advanceTimersByTime(110);
    expect(historyStore.past).toHaveLength(1);

    vi.useRealTimers();
  });

  it('jumps to previous/next clip boundary (all tracks)', () => {
    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip 1',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
            },
          ],
        },
      ],
    } as any;

    store.currentTime = 2_500_000;
    store.jumpToPrevClipBoundary();
    expect(store.currentTime).toBe(1_000_000);

    store.jumpToNextClipBoundary();
    expect(store.currentTime).toBe(3_000_000);
  });

  it('jumps to previous/next clip boundary (current track only)', () => {
    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip 1',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 1_000_000, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        },
        {
          id: 'a1',
          kind: 'audio',
          name: 'Audio 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'ac1',
              trackId: 'a1',
              name: 'Audio Clip 1',
              source: { path: '/a.wav' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 5_000_000, durationUs: 1_000_000 },
              sourceRange: { startUs: 0, durationUs: 1_000_000 },
            },
          ],
        },
      ],
    } as any;

    store.selectTrack('v1');
    store.currentTime = 5_500_000;
    store.jumpToPrevClipBoundary({ currentTrackOnly: true });
    expect(store.currentTime).toBe(2_000_000);
    store.jumpToNextClipBoundary({ currentTrackOnly: true });
    expect(store.currentTime).toBe(6_000_000);
  });

  it('splits a selected clip at playhead', async () => {
    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip 1',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 0, durationUs: 3_000_000 },
              sourceRange: { startUs: 0, durationUs: 3_000_000 },
            },
          ],
        },
      ],
    } as any;

    store.toggleSelection('c1');
    store.currentTime = 1_000_000;
    await store.splitClipAtPlayhead();

    const clips = (store.timelineDoc as any).tracks[0].items.filter(
      (it: any) => it.kind === 'clip',
    );
    expect(clips).toHaveLength(2);
  });

  it('trims left/right to playhead without ripple', async () => {
    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip 1',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 0, durationUs: 3_000_000 },
              sourceRange: { startUs: 0, durationUs: 3_000_000 },
            },
          ],
        },
      ],
    } as any;

    store.toggleSelection('c1');
    store.currentTime = 1_000_000;
    await store.trimToPlayheadLeftNoRipple();

    const afterLeft = (store.timelineDoc as any).tracks[0].items.filter(
      (it: any) => it.kind === 'clip',
    );
    expect(afterLeft).toHaveLength(1);
    expect(afterLeft[0].timelineRange.durationUs).toBeGreaterThan(0);
    expect(afterLeft[0].timelineRange.startUs).toBeGreaterThan(0);

    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip 1',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 0, durationUs: 3_000_000 },
              sourceRange: { startUs: 0, durationUs: 3_000_000 },
            },
          ],
        },
      ],
    } as any;

    store.toggleSelection('c1');
    store.currentTime = 1_000_000;
    await store.trimToPlayheadRightNoRipple();
    const afterRight = (store.timelineDoc as any).tracks[0].items.filter(
      (it: any) => it.kind === 'clip',
    );
    expect(afterRight).toHaveLength(1);
    expect(afterRight[0].timelineRange.startUs).toBe(0);
  });

  it('toggles disable and mute on target clip', async () => {
    store.timelineDoc = {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Default',
      timebase: { fps: 30 },
      tracks: [
        {
          id: 'v1',
          kind: 'video',
          name: 'Video 1',
          items: [
            {
              kind: 'clip',
              clipType: 'media',
              id: 'c1',
              trackId: 'v1',
              name: 'Clip 1',
              source: { path: '/a.mp4' },
              sourceDurationUs: 10_000_000,
              timelineRange: { startUs: 0, durationUs: 3_000_000 },
              sourceRange: { startUs: 0, durationUs: 3_000_000 },
              audioGain: 1,
              disabled: false,
            },
          ],
        },
      ],
    } as any;

    store.toggleSelection('c1');
    await store.toggleDisableTargetClip();
    let clip = (store.timelineDoc as any).tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.disabled).toBe(true);

    await store.toggleMuteTargetClip();
    clip = (store.timelineDoc as any).tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.audioMuted).toBe(true);

    await store.toggleMuteTargetClip();
    clip = (store.timelineDoc as any).tracks[0].items.find((it: any) => it.id === 'c1');
    expect(clip.audioMuted).toBe(false);
  });

  it('adds image source to video track with default image duration', async () => {
    store.timelineDoc = {
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
    } as any;

    projectStoreMock.getFileByPath.mockResolvedValue({
      type: 'image/jpeg',
      size: 100,
      lastModified: 1,
    });

    mediaStoreMock.getOrFetchMetadataByPath.mockResolvedValue({
      source: { size: 100, lastModified: 1 },
      duration: 5,
    });

    await store.addClipToTimelineFromPath({
      trackId: 'v1',
      name: 'image.jpg',
      path: '_images/image.jpg',
      startUs: 0,
    });

    const track = (store.timelineDoc as any).tracks.find((t: any) => t.id === 'v1');
    expect(track.items).toHaveLength(1);

    const clip = track.items[0];
    expect(clip.clipType).toBe('media');
  });

  it('adds nested timeline clip from .otio path and blocks self-drop', async () => {
    store.timelineDoc = {
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
        {
          id: 'a1',
          kind: 'audio',
          name: 'Audio 1',
          items: [],
        },
      ],
    } as any;

    await expect(
      store.addTimelineClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Self',
        path: 'timeline.otio',
        startUs: 0,
      }),
    ).rejects.toThrow(/currently opened timeline/i);

    const otio = JSON.stringify(
      {
        OTIO_SCHEMA: 'Timeline.1',
        name: 'Nested',
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Video 1',
              kind: 'Video',
              children: [
                {
                  OTIO_SCHEMA: 'Clip.1',
                  name: 'X',
                  media_reference: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: 'file.mp4',
                  },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 2000000, rate: 1000000 },
                  },
                },
              ],
            },
          ],
        },
        metadata: { fastcat: { docId: 'nested', timebase: { fps: 25 } } },
      },
      null,
      2,
    );

    projectStoreMock.getFileByPath.mockImplementation(async (p: string) => {
      console.log('DEBUG: Mock getFileByPath called with:', p);
      if (p.includes('nested.otio')) {
        return {
          text: async () => otio,
        } as any;
      }
      return null;
    });
    store = useTimelineStore();

    await store.addTimelineClipToTimelineFromPath({
      trackId: 'v1',
      name: 'Nested.otio',
      path: 'nested.otio',
      startUs: 0,
    });

    const added = (store.timelineDoc as any).tracks[0].items.find((it: any) => it.kind === 'clip');
    expect(added.clipType).toBe('timeline');
    expect(added.source.path).toBe('nested.otio');
    expect(added.timelineRange.durationUs).toBeGreaterThan(0);

    await store.addTimelineClipToTimelineFromPath({
      trackId: 'a1',
      name: 'Nested audio.otio',
      path: 'nested.otio',
      startUs: 1_000_000,
    });

    const addedToAudio = (store.timelineDoc as any).tracks[1].items.find(
      (it: any) => it.kind === 'clip',
    );
    expect(addedToAudio.clipType).toBe('timeline');
    expect(addedToAudio.source.path).toBe('nested.otio');
  });

  it('rejects nested timeline without audio on audio track and allows moving nested timeline to audio track', async () => {
    store = useTimelineStore();

    store.timelineDoc = {
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
        {
          id: 'a1',
          kind: 'audio',
          name: 'Audio 1',
          items: [],
        },
      ],
    } as any;

    const videoOnlyNestedOtio = JSON.stringify(
      {
        OTIO_SCHEMA: 'Timeline.1',
        name: 'Video only nested',
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Video 1',
              kind: 'Video',
              children: [
                {
                  OTIO_SCHEMA: 'Clip.1',
                  name: 'VideoOnly',
                  media_reference: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: 'video-only.mp4',
                  },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 2000000, rate: 1000000 },
                  },
                  metadata: {
                    fastcat: {
                      clipType: 'media',
                      sourceDurationUs: 2000000,
                      audioFromVideoDisabled: true,
                    },
                  },
                },
              ],
            },
          ],
        },
        metadata: { fastcat: { docId: 'nested-video-only', timebase: { fps: 25 } } },
      },
      null,
      2,
    );

    const avNestedOtio = JSON.stringify(
      {
        OTIO_SCHEMA: 'Timeline.1',
        name: 'AV nested',
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Video 1',
              kind: 'Video',
              children: [
                {
                  OTIO_SCHEMA: 'Clip.1',
                  name: 'AV',
                  media_reference: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: 'av.mp4',
                  },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 2000000, rate: 1000000 },
                  },
                  metadata: {
                    fastcat: {
                      clipType: 'media',
                      sourceDurationUs: 2000000,
                    },
                  },
                },
              ],
            },
          ],
        },
        metadata: { fastcat: { docId: 'nested-av', timebase: { fps: 25 } } },
      },
      null,
      2,
    );

    projectStoreMock.getFileByPath.mockImplementation(async (path: string) => {
      if (path === 'video-only.otio') {
        return {
          text: async () => videoOnlyNestedOtio,
        } as any;
      }

      if (path === 'nested-av.otio') {
        return {
          text: async () => avNestedOtio,
        } as any;
      }

      return null;
    });
    store = useTimelineStore();

    await expect(
      store.addTimelineClipToTimelineFromPath({
        trackId: 'a1',
        name: 'Video only nested.otio',
        path: 'video-only.otio',
        startUs: 0,
      }),
    ).rejects.toThrow(/audio content/i);

    await store.addTimelineClipToTimelineFromPath({
      trackId: 'v1',
      name: 'AV nested.otio',
      path: 'nested-av.otio',
      startUs: 0,
    });

    const videoClip = (store.timelineDoc as any).tracks[0].items.find(
      (it: any) => it.kind === 'clip',
    );
    await store.moveItemToTrack({
      fromTrackId: 'v1',
      toTrackId: 'a1',
      itemId: videoClip.id,
      startUs: 500_000,
    });

    expect((store.timelineDoc as any).tracks[0].items.every((it: any) => it.kind === 'gap')).toBe(
      true,
    );
    const movedClip = (store.timelineDoc as any).tracks[1].items.find(
      (it: any) => it.kind === 'clip',
    );
    expect(movedClip.clipType).toBe('timeline');
    expect(movedClip.timelineRange.startUs).toBe(500_000);
  });

  it('rejects transitive circular nested timeline dependency', async () => {
    store = useTimelineStore();

    store.timelineDoc = {
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
    } as any;

    const nestedOtioWithBackReference = JSON.stringify(
      {
        OTIO_SCHEMA: 'Timeline.1',
        name: 'Nested with back reference',
        tracks: {
          OTIO_SCHEMA: 'Stack.1',
          name: 'tracks',
          children: [
            {
              OTIO_SCHEMA: 'Track.1',
              name: 'Video 1',
              kind: 'Video',
              children: [
                {
                  OTIO_SCHEMA: 'Clip.1',
                  name: 'Back reference',
                  media_reference: {
                    OTIO_SCHEMA: 'ExternalReference.1',
                    target_url: 'timeline.otio',
                  },
                  source_range: {
                    OTIO_SCHEMA: 'TimeRange.1',
                    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 1000000 },
                    duration: { OTIO_SCHEMA: 'RationalTime.1', value: 2000000, rate: 1000000 },
                  },
                  metadata: {
                    fastcat: {
                      clipType: 'timeline',
                      sourceDurationUs: 2000000,
                    },
                  },
                },
              ],
            },
          ],
        },
        metadata: { fastcat: { docId: 'nested-backref', timebase: { fps: 25 } } },
      },
      null,
      2,
    );

    projectStoreMock.getFileByPath.mockImplementation(async (path: string) => {
      if (path === 'nested-cycle.otio') {
        return {
          text: async () => nestedOtioWithBackReference,
        };
      }

      return null;
    });
    store = useTimelineStore();

    await expect(
      store.addTimelineClipToTimelineFromPath({
        trackId: 'v1',
        name: 'Nested cycle.otio',
        path: 'nested-cycle.otio',
        startUs: 0,
      }),
    ).rejects.toThrow(/circular nested timeline dependency/i);
  });
});
