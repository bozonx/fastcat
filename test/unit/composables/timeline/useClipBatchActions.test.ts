import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';

function makeClip(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'v1',
    clipType: 'media',
    name: 'Clip 1',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    sourceDurationUs: 5_000_000,
    source: { path: '/video.mp4' },
    ...overrides,
  };
}

function build() {
  const videoClip = makeClip({ id: 'video-1', trackId: 'v1' });
  const imageClip = makeClip({ id: 'image-1', trackId: 'v1', isImage: true });
  const textClip = makeClip({ id: 'text-1', trackId: 'v1', clipType: 'text', source: undefined });
  const audioClip = makeClip({ id: 'audio-1', trackId: 'a1' });
  const timelineDoc = ref<any>({
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc-1',
    name: 'Timeline',
    timebase: { fps: 30 },
    tracks: [
      { id: 'v1', kind: 'video', name: 'Video', items: [videoClip, imageClip, textClip] },
      { id: 'a1', kind: 'audio', name: 'Audio', items: [audioClip] },
    ],
  });
  const items = ref([
    { trackId: 'v1', itemId: 'video-1' },
    { trackId: 'v1', itemId: 'image-1' },
    { trackId: 'v1', itemId: 'text-1' },
    { trackId: 'a1', itemId: 'audio-1' },
  ]);
  const batchApplyTimeline = vi.fn();
  const actions = useClipBatchActions(items, {
    timelineDoc,
    mediaMetadata: ref({}),
    batchApplyTimeline,
    clearSelection: vi.fn(),
  });
  return { actions, batchApplyTimeline };
}

describe('useClipBatchActions', () => {
  it('applies waveform changes only to clips that support waveform controls', () => {
    const { actions, batchApplyTimeline } = build();

    actions.toggleShowWaveform();

    expect(batchApplyTimeline).toHaveBeenCalledWith(
      [
        {
          type: 'update_clip_properties',
          trackId: 'v1',
          itemId: 'video-1',
          properties: { showWaveform: false },
        },
        {
          type: 'update_clip_properties',
          trackId: 'a1',
          itemId: 'audio-1',
          properties: { showWaveform: false },
        },
      ],
      { labelKey: 'videoEditor.fileManager.history.entries.toggleWaveform' },
    );
  });

  it('exposes speed targets only for audio and non-image media/timeline clips', () => {
    const { actions } = build();

    expect(actions.hasSpeedControls.value).toBe(true);
    expect(actions.speedClipRefs.value.map(({ clip }) => clip.id)).toEqual(['video-1', 'audio-1']);
  });

  it('applies generic visual properties only to explicit targets when provided', () => {
    const { actions, batchApplyTimeline } = build();

    actions.handleBatchUpdateProperties(
      { opacity: 0.5 },
      actions.visualClipRefs.value.map(({ track, clip }) => ({
        trackId: track.id,
        itemId: clip.id,
      })),
    );

    expect(batchApplyTimeline).toHaveBeenCalledWith(
      [
        {
          type: 'update_clip_properties',
          trackId: 'v1',
          itemId: 'video-1',
          properties: { opacity: 0.5 },
        },
        {
          type: 'update_clip_properties',
          trackId: 'v1',
          itemId: 'image-1',
          properties: { opacity: 0.5 },
        },
        {
          type: 'update_clip_properties',
          trackId: 'v1',
          itemId: 'text-1',
          properties: { opacity: 0.5 },
        },
      ],
      { labelKey: 'videoEditor.fileManager.history.entries.updateClipProperties' },
    );
  });
});
