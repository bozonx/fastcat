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
    // @ts-expect-error -- mocking useNuxtApp for test environment
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
    const pastedItems = await store.pasteClips(copiedItems, {
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
    const pastedItems = await store.pasteClips(copiedItems, {
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

  it('creates a new linked group on paste instead of reusing the original group id', async () => {
    const store = useTimelineStore();
    const builder = new TimelineBuilder();
    store.timelineDoc = builder
      .withTrack('v1', 'video', 'Video 1')
      .withTrack('a1', 'audio', 'Audio 1')
      .withClip('vclip', 'v1', { startUs: 0, durationUs: 1_000_000 })
      .withClip('aclip', 'a1', { startUs: 0, durationUs: 1_000_000 })
      .build() as any;

    const video = store.timelineDoc.tracks[0].items.find((item: any) => item.id === 'vclip');
    const audio = store.timelineDoc.tracks[1].items.find((item: any) => item.id === 'aclip');
    video.linkedGroupId = 'original-group';
    audio.linkedGroupId = 'original-group';
    audio.linkedVideoClipId = 'vclip';
    audio.lockToLinkedVideo = true;

    store.selectedItemIds = ['vclip', 'aclip'];
    const copiedItems = store.copySelectedClips();

    const pastedItems = await store.pasteClips(copiedItems, {
      targetTrackId: 'v1',
      insertStartUs: 5_000_000,
    });

    const pastedVideo = store.timelineDoc.tracks
      .flatMap((track: any) => track.items)
      .find((item: any) => item.id === pastedItems.find((item) => item.trackId === 'v1')?.itemId);
    const pastedAudio = store.timelineDoc.tracks
      .flatMap((track: any) => track.items)
      .find((item: any) => item.id === pastedItems.find((item) => item.trackId === 'a1')?.itemId);

    expect(pastedVideo.linkedGroupId).toBeTruthy();
    expect(pastedVideo.linkedGroupId).toBe(pastedAudio.linkedGroupId);
    expect(pastedVideo.linkedGroupId).not.toBe('original-group');
    expect(pastedAudio.linkedVideoClipId).toBe(pastedVideo.id);
    expect(pastedAudio.lockToLinkedVideo).toBe(true);
  });

  it('drops linked video lock when pasting only linked audio', async () => {
    const store = useTimelineStore();
    const builder = new TimelineBuilder();
    store.timelineDoc = builder
      .withTrack('v1', 'video', 'Video 1')
      .withTrack('a1', 'audio', 'Audio 1')
      .withClip('vclip', 'v1', { startUs: 0, durationUs: 1_000_000 })
      .withClip('aclip', 'a1', { startUs: 0, durationUs: 1_000_000 })
      .build() as any;

    const audio = store.timelineDoc.tracks[1].items.find((item: any) => item.id === 'aclip');
    audio.linkedVideoClipId = 'vclip';
    audio.lockToLinkedVideo = true;

    store.selectedItemIds = ['aclip'];
    const copiedItems = store.copySelectedClips();

    const [pasted] = await store.pasteClips(copiedItems, {
      targetTrackId: 'a1',
      insertStartUs: 5_000_000,
    });

    const pastedAudio = store.timelineDoc.tracks
      .flatMap((track: any) => track.items)
      .find((item: any) => item.id === pasted?.itemId);

    expect(pastedAudio.linkedVideoClipId).toBeUndefined();
    expect(pastedAudio.lockToLinkedVideo).toBe(false);
  });

  it('preserves clip active flags, mask and hud frame properties on paste', async () => {
    const store = useTimelineStore();
    const builder = new TimelineBuilder();
    store.timelineDoc = builder
      .withTrack('v1', 'video', 'Video 1')
      .withClip('clip1', 'v1', { startUs: 0, durationUs: 1_000_000, clipType: 'media' })
      .build() as any;

    const clip = store.timelineDoc.tracks[0].items.find((item: any) => item.id === 'clip1');
    Object.assign(clip, {
      speedActive: true,
      transformActive: true,
      opacityActive: true,
      blendModeActive: true,
      audioFadesActive: true,
      maskActive: true,
      mask: { source: { path: '/mask.png' }, mode: 'alpha' },
      frame: { scaleX: 1.5 },
    });

    store.selectedItemIds = ['clip1'];
    const copiedItems = store.copySelectedClips();
    const [pasted] = await store.pasteClips(copiedItems, {
      targetTrackId: 'v1',
      insertStartUs: 5_000_000,
    });

    const pastedClip = store.timelineDoc.tracks[0].items.find(
      (item: any) => item.id === pasted?.itemId,
    );
    expect(pastedClip.speedActive).toBe(true);
    expect(pastedClip.transformActive).toBe(true);
    expect(pastedClip.opacityActive).toBe(true);
    expect(pastedClip.blendModeActive).toBe(true);
    expect(pastedClip.audioFadesActive).toBe(true);
    expect(pastedClip.maskActive).toBe(true);
    expect(pastedClip.mask).toEqual({ source: { path: '/mask.png' }, mode: 'alpha' });
    expect(pastedClip.frame).toEqual({ scaleX: 1.5 });
  });

  it('keeps pasted audio clips on compatible audio tracks', async () => {
    const store = useTimelineStore();
    const builder = new TimelineBuilder();
    store.timelineDoc = builder
      .withTrack('v1', 'video', 'Video 1')
      .withTrack('v2', 'video', 'Video 2')
      .withTrack('a1', 'audio', 'Audio 1')
      .withClip('aclip', 'a1', { startUs: 0, durationUs: 1_000_000 })
      .build() as any;

    store.selectedItemIds = ['aclip'];
    const copiedItems = store.copySelectedClips();
    const [pasted] = await store.pasteClips(copiedItems, {
      targetTrackId: 'v2',
      insertStartUs: 5_000_000,
    });

    expect(pasted?.trackId).toBe('a1');
    const pastedAudio = store.timelineDoc.tracks
      .find((track: any) => track.id === 'a1')
      ?.items.find((item: any) => item.id === pasted?.itemId);
    expect(pastedAudio).toBeTruthy();
  });
});
