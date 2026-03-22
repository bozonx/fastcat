import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { TimelineBuilder } from '../utils/timeline-builder';

// Mock dependencies if needed
vi.mock('~/services/AppNotificationService', () => ({}));
vi.mock('~/services/I18nService', () => ({}));

describe('TimelineStore Copy/Paste', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    
    // Mock nuxtApp for i18n and notification
    // @ts-ignore
    global.useNuxtApp = () => ({
      $notificationService: {},
      $i18nService: { t: (key: string) => key },
    });
  });

  it('copies and pastes media clips with properties', async () => {
    const store = useTimelineStore();
    const builder = new TimelineBuilder();
    store.timelineDoc = builder
      .withTrack('v1', 'video', 'Video 1')
      .withClip('clip1', 'v1', { startUs: 0, durationUs: 5_000_000 })
      .build() as any;
    
    // Select clip1
    store.toggleSelection('clip1');
    
    // Set some properties
    store.updateClipProperties('v1', 'clip1', {
      opacity: 0.5,
      disabled: true,
    });

    const copiedItems = store.copySelectedClips();
    expect(copiedItems).toHaveLength(1);
    expect(copiedItems[0].clip.id).toBe('clip1');
    expect(copiedItems[0].clip.opacity).toBe(0.5);

    // Paste at 10s on the same track
    store.currentTime = 10_000_000;
    const pastedItems = store.pasteClips(copiedItems, {
      targetTrackId: 'v1',
    });

    expect(pastedItems).toHaveLength(1);
    expect(pastedItems[0].trackId).toBe('v1');
    
    const doc = store.timelineDoc!;
    const track = doc.tracks.find(t => t.id === 'v1')!;
    const pastedClip = track.items.find(it => it.kind === 'clip' && it.id === pastedItems[0].itemId) as any;
    
    expect(pastedClip).toBeDefined();
    expect(pastedClip.timelineRange.startUs).toBe(10_000_000);
    expect(pastedClip.opacity).toBe(0.5);
    expect(pastedClip.disabled).toBe(true);
    expect(pastedClip.source.path).toBe('/dummy.mp4');
  });

  it('cuts clips from timeline', () => {
    const store = useTimelineStore();
    const builder = new TimelineBuilder();
    store.timelineDoc = builder
      .withTrack('v1', 'video', 'Video 1')
      .withClip('clip1', 'v1', { startUs: 0, durationUs: 5_000_000 })
      .build() as any;
    
    store.toggleSelection('clip1');
    const cutItems = store.cutSelectedClips();
    
    expect(cutItems).toHaveLength(1);
    const track = store.timelineDoc!.tracks.find(t => t.id === 'v1')!;
    expect(track.items.find(it => it.id === 'clip1')).toBeUndefined();
  });
});
