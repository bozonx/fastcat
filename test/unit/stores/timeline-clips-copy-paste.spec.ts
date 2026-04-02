/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { TimelineBuilder } from '../utils/timeline-builder';

// Mock dependencies if needed
vi.mock('~/services/app-notification.service', () => ({}));
vi.mock('~/services/i18n.service', () => ({}));

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
    const track = doc.tracks.find((t: any) => t.id === 'v1')!;
    const pastedClip = track.items.find(
      (it: any) => it.kind === 'clip' && it.id === pastedItems[0].itemId,
    ) as any;

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
    const track = store.timelineDoc!.tracks.find((t: any) => t.id === 'v1')!;
    expect(track.items.find((it: any) => it.id === 'clip1')).toBeUndefined();
  });

  it('pastes multiple clips across multiple tracks correctly', async () => {
    const store = useTimelineStore();
    const builder = new TimelineBuilder();
    store.timelineDoc = builder
      .withTrack('v1', 'video', 'Video 1')
      .withTrack('v2', 'video', 'Video 2')
      .withTrack('v3', 'video', 'Video 1 Target')
      .withTrack('v4', 'video', 'Video 2 Target')
      .withClip('c1', 'v1', { startUs: 0, durationUs: 1_000_000 })
      .withClip('c2', 'v2', { startUs: 0, durationUs: 1_000_000 })
      .build() as any;

    // Select both c1 and c2
    store.selectedItemIds = ['c1', 'c2'];

    // Copy them
    const copiedItems = store.copySelectedClips();
    expect(copiedItems).toHaveLength(2);

    // Select the "base" target track (v3)
    store.selectedTrackId = 'v3';
    store.selectedItemIds = [];

    // Paste at 5s
    store.currentTime = 5_000_000;
    const pastedItems = store.pasteClips(copiedItems, {
      targetTrackId: 'v3',
    });

    expect(pastedItems).toHaveLength(2);

    // c1 is from v1, c2 is from v2. v1 is index 0, v2 is index 1.
    // Offset for c1: 0. Offset for c2: 1.
    // Target for c1: v3 (index 2). Target for c2: v4 (index 3).

    const pasted1 = pastedItems.find((it: any) => it.trackId === 'v3')!;
    const pasted2 = pastedItems.find((it: any) => it.trackId === 'v4')!;

    expect(pasted1).toBeDefined();
    expect(pasted2).toBeDefined();

    const track3 = store.timelineDoc!.tracks.find((t: any) => t.id === 'v3')!;
    const track4 = store.timelineDoc!.tracks.find((t: any) => t.id === 'v4')!;

    expect(track3.items.some((it: any) => it.id === pasted1.itemId)).toBe(true);
    expect(track3.items.find((it: any) => it.id === pasted1.itemId)!.timelineRange.startUs).toBe(
      5_000_000,
    );

    expect(track4.items.some((it: any) => it.id === pasted2.itemId)).toBe(true);
    expect(track4.items.find((it: any) => it.id === pasted2.itemId)!.timelineRange.startUs).toBe(
      5_000_000,
    );
  });
});
