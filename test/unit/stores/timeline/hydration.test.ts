/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { createTimelineHydrationModule } from '~/stores/timeline/hydration';
import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';

function makeDoc(overrides?: Partial<TimelineDocument>): TimelineDocument {
  return {
    tracks: [
      {
        id: 't1',
        name: 'Track 1',
        items: [
          {
            id: 'c1',
            kind: 'clip',
            clipType: 'media',
            source: { path: '/path/video.mp4' },
            sourceDurationTicks: 0,
            isImage: false,
          },
        ],
      },
    ],
    timebase: { fps: 30 },
    durationTicks: 0,
    ...overrides,
  } as unknown as TimelineDocument;
}

describe('createTimelineHydrationModule', () => {
  it('hydrateAllClips returns doc unchanged when no metadata matches', () => {
    const mediaMetadata = ref({});
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const result = mod.hydrateAllClips(doc);
    expect(result).toBe(doc);
  });

  it('hydrateAllClips patches sourceDurationTicks from metadata', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 10, video: { width: 1920, height: 1080 } },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const result = mod.hydrateAllClips(doc);
    expect(result).not.toBe(doc);
    const clip = result.tracks[0]!.items[0] as { sourceDurationTicks: number };
    expect(clip.sourceDurationTicks).toBe(2_540_160_000_000);
  });

  it('hydrateAllClips sets isImage for image-like media (no video/audio)', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 0 },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const result = mod.hydrateAllClips(doc);
    const clip = result.tracks[0]!.items[0] as { isImage: boolean };
    expect(clip.isImage).toBe(true);
  });

  it('hydrateAllClips returns doc unchanged when already hydrated', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 10, video: { width: 1920, height: 1080 } },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    // First hydration patches the doc
    const first = mod.hydrateAllClips(doc);
    // Second hydration should be a no-op
    const second = mod.hydrateAllClips(first);
    expect(second).toBe(first);
  });

  it('hydrateClipSourceDuration returns doc for irrelevant command types', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 10, video: {} },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const cmd = { type: 'add_track', trackId: 't1' } as unknown as TimelineCommand;
    const result = mod.hydrateClipSourceDuration(doc, cmd);
    expect(result).toBe(doc);
  });

  it('hydrateClipSourceDuration patches clip for trim_item command', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 5, video: { width: 1280, height: 720 } },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const cmd = {
      type: 'trim_item',
      trackId: 't1',
      itemId: 'c1',
    } as unknown as TimelineCommand;
    const result = mod.hydrateClipSourceDuration(doc, cmd);
    expect(result).not.toBe(doc);
    const clip = result.tracks[0]!.items[0] as { sourceDurationTicks: number };
    expect(clip.sourceDurationTicks).toBe(1_270_080_000_000);
  });

  it('hydrateClipSourceDuration returns doc when track not found', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 5, video: {} },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const cmd = {
      type: 'trim_item',
      trackId: 'nonexistent',
      itemId: 'c1',
    } as unknown as TimelineCommand;
    const result = mod.hydrateClipSourceDuration(doc, cmd);
    expect(result).toBe(doc);
  });

  it('hydrateClipSourceDuration returns doc when item not found', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 5, video: {} },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const cmd = {
      type: 'trim_item',
      trackId: 't1',
      itemId: 'nonexistent',
    } as unknown as TimelineCommand;
    const result = mod.hydrateClipSourceDuration(doc, cmd);
    expect(result).toBe(doc);
  });

  it('hydrateClipSourceDuration returns doc when no metadata for path', () => {
    const mediaMetadata = ref({});
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const cmd = {
      type: 'trim_item',
      trackId: 't1',
      itemId: 'c1',
    } as unknown as TimelineCommand;
    const result = mod.hydrateClipSourceDuration(doc, cmd);
    expect(result).toBe(doc);
  });

  it('hydrateClipSourceDuration uses fromTrackId for move_item_to_track', () => {
    const mediaMetadata = ref({
      '/path/video.mp4': { duration: 8, video: {} },
    });
    const mod = createTimelineHydrationModule({ mediaMetadata });
    const doc = makeDoc();
    const cmd = {
      type: 'move_item_to_track',
      fromTrackId: 't1',
      itemId: 'c1',
    } as unknown as TimelineCommand;
    const result = mod.hydrateClipSourceDuration(doc, cmd);
    expect(result).not.toBe(doc);
    const clip = result.tracks[0]!.items[0] as { sourceDurationTicks: number };
    expect(clip.sourceDurationTicks).toBe(2_032_128_000_000);
  });
});
