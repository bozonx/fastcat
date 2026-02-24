import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineStore } from '../../../src/stores/timeline.store';

vi.mock('../../../src/stores/project.store', () => ({
  useProjectStore: () => ({
    currentProjectName: { value: 'test' },
    currentTimelinePath: { value: 'timeline.otio' },
    createFallbackTimelineDoc: () => ({
      id: 'doc-1',
      name: 'Default',
      tracks: [],
      timebase: { fps: 30 },
    }),
  }),
}));

vi.mock('../../../src/stores/media.store', () => ({
  useMediaStore: () => ({
    mediaMetadata: { value: {} },
    getOrFetchMetadataByPath: vi.fn(),
  }),
}));

describe('TimelineStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('initializes with default state', () => {
    const store = useTimelineStore();
    expect(store.timelineDoc).toBeNull();
    expect(store.isPlaying).toBe(false);
    expect(store.audioVolume).toBe(1);
  });

  it('manages item selection', () => {
    const store = useTimelineStore();
    store.toggleSelection('item-1');
    expect(store.selectedItemIds).toEqual(['item-1']);

    store.toggleSelection('item-2', { multi: true });
    expect(store.selectedItemIds).toContain('item-1');
    expect(store.selectedItemIds).toContain('item-2');

    store.clearSelection();
    expect(store.selectedItemIds).toEqual([]);
  });

  it('sets audio volume and unmutes when positive', () => {
    const store = useTimelineStore();
    store.audioMuted = true;
    store.setAudioVolume(0.5);
    expect(store.audioVolume).toBe(0.5);
    expect(store.audioMuted).toBe(false);
  });

  it('toggles playback', () => {
    const store = useTimelineStore();
    const handler = vi.fn();
    store.setPlaybackGestureHandler(handler);

    store.togglePlayback();
    expect(store.isPlaying).toBe(true);
    expect(handler).toHaveBeenCalledWith(true);

    store.togglePlayback();
    expect(store.isPlaying).toBe(false);
    expect(handler).toHaveBeenCalledWith(false);
  });

  it('resets state correctly', () => {
    const store = useTimelineStore();
    store.isPlaying = true;
    store.currentTime = 100;
    store.timelineZoom = 150;

    store.resetTimelineState();

    expect(store.isPlaying).toBe(false);
    expect(store.currentTime).toBe(0);
    expect(store.timelineZoom).toBe(100);
  });

  it('sets freeze frame from playhead when playhead is inside clip', () => {
    const store = useTimelineStore();

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
              sourceRange: { startUs: 0, durationUs: 2_000_000 },
            },
          ],
        },
      ],
    } as any;

    store.currentTime = 1_500_000;
    store.setClipFreezeFrameFromPlayhead({ trackId: 'v1', itemId: 'c1' });

    const clip = (store.timelineDoc as any).tracks[0].items[0];
    expect(typeof clip.freezeFrameSourceUs).toBe('number');
    expect(clip.freezeFrameSourceUs).toBeGreaterThanOrEqual(0);
  });

  it('sets freeze frame to first frame when playhead is outside clip', () => {
    const store = useTimelineStore();

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

    const clip = (store.timelineDoc as any).tracks[0].items[0];
    expect(clip.freezeFrameSourceUs).toBe(133_333);
  });

  it('resets freeze frame', () => {
    const store = useTimelineStore();

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
});
