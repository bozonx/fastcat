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
});
