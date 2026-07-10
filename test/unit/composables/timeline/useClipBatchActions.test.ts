import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useClipBatchActions } from '~/composables/timeline/useClipBatchActions';
import type {
  TimelineClipItem,
  TimelineDocument,
  TimelineMediaClipItem,
  TimelineTrack,
} from '~/timeline/types';

function makeClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  const base: TimelineMediaClipItem = {
    id: 'clip-1',
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    name: 'Clip 1',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    sourceDurationUs: 5_000_000,
    source: { path: '/video.mp4' },
  };
  return { ...base, ...overrides } as TimelineClipItem;
}

function makeTrack(
  overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'kind'>,
): TimelineTrack {
  return {
    name: overrides.id,
    items: [],
    ...overrides,
  };
}

function build(
  options: {
    docOverrides?: Partial<TimelineDocument>;
    tracks?: TimelineTrack[];
    selection?: Array<{ trackId: string; itemId: string }>;
  } = {},
) {
  const videoClip = makeClip({ id: 'video-1', trackId: 'v1' });
  const imageClip = makeClip({ id: 'image-1', trackId: 'v1', isImage: true });
  const textClip = makeClip({ id: 'text-1', trackId: 'v1', clipType: 'text', source: undefined });
  const audioClip = makeClip({ id: 'audio-1', trackId: 'a1' });

  const tracks = options.tracks ?? [
    makeTrack({ id: 'v1', kind: 'video', name: 'Video', items: [videoClip, imageClip, textClip] }),
    makeTrack({ id: 'a1', kind: 'audio', name: 'Audio', items: [audioClip] }),
  ];

  const timelineDoc = ref<TimelineDocument | null>({
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc-1',
    name: 'Timeline',
    timebase: { fps: 30 },
    tracks,
    ...options.docOverrides,
  });

  const items = ref(
    options.selection ?? [
      { trackId: 'v1', itemId: 'video-1' },
      { trackId: 'v1', itemId: 'image-1' },
      { trackId: 'v1', itemId: 'text-1' },
      { trackId: 'a1', itemId: 'audio-1' },
    ],
  );
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

  it('shifts only unlocked clips on unlocked tracks', () => {
    const lockedClip = makeClip({ id: 'video-1', trackId: 'v1', locked: true });
    const freeClip = makeClip({ id: 'video-2', trackId: 'v1' });
    const lockedTrackClip = makeClip({ id: 'video-3', trackId: 'v2' });
    const { actions, batchApplyTimeline } = build({
      tracks: [
        makeTrack({ id: 'v1', kind: 'video', name: 'Video', items: [lockedClip, freeClip] }),
        makeTrack({
          id: 'v2',
          kind: 'video',
          name: 'Locked',
          locked: true,
          items: [lockedTrackClip],
        }),
      ],
      selection: [
        { trackId: 'v1', itemId: 'video-1' },
        { trackId: 'v1', itemId: 'video-2' },
        { trackId: 'v2', itemId: 'video-3' },
      ],
    });

    actions.handleRelativeStartShift(1_000_000);

    expect(batchApplyTimeline).toHaveBeenCalledTimes(1);
    expect(batchApplyTimeline).toHaveBeenCalledWith(
      [
        {
          type: 'move_item',
          trackId: 'v1',
          itemId: 'video-2',
          startUs: 1_000_000,
        },
      ],
      { labelKey: 'videoEditor.fileManager.history.entries.moveItems', historyMode: 'debounced' },
    );
  });

  it('quantizes only frame-free clips and reports them via hasFreeClip', () => {
    // 5333us start at 30fps lands between frame boundaries → not aligned.
    const freeClip = makeClip({
      id: 'free-1',
      trackId: 'v1',
      timelineRange: { startUs: 5_333, durationUs: 5_000_000 },
    });
    const alignedClip = makeClip({
      id: 'aligned-1',
      trackId: 'v1',
      timelineRange: { startUs: 0, durationUs: 5_000_000 },
    });
    const { actions, batchApplyTimeline } = build({
      tracks: [
        makeTrack({ id: 'v1', kind: 'video', name: 'Video', items: [freeClip, alignedClip] }),
      ],
      selection: [
        { trackId: 'v1', itemId: 'free-1' },
        { trackId: 'v1', itemId: 'aligned-1' },
      ],
    });

    expect(actions.hasFreeClip.value).toBe(true);

    actions.handleQuantizeSelected();

    expect(batchApplyTimeline).toHaveBeenCalledTimes(1);
    expect(batchApplyTimeline).toHaveBeenCalledWith([
      {
        type: 'move_item',
        trackId: 'v1',
        itemId: 'free-1',
        startUs: 0,
        quantizeToFrames: false,
      },
      {
        type: 'trim_item',
        trackId: 'v1',
        itemId: 'free-1',
        edge: 'end',
        deltaUs: 0,
        quantizeToFrames: false,
      },
    ]);
  });

  it('reports isSingleGroupSelection as false for empty or single selections', () => {
    const { actions } = build({ selection: [] });
    expect(actions.isSingleGroupSelection.value).toBe(false);

    const { actions: singleActions } = build({
      selection: [{ trackId: 'v1', itemId: 'video-1' }],
    });
    expect(singleActions.isSingleGroupSelection.value).toBe(false);
  });

  it('reports isSingleGroupSelection as true when all selected clips share one linkedGroupId', () => {
    const clipA = makeClip({ id: 'a', trackId: 'v1', linkedGroupId: 'g1' });
    const clipB = makeClip({ id: 'b', trackId: 'v1', linkedGroupId: 'g1' });
    const { actions } = build({
      tracks: [makeTrack({ id: 'v1', kind: 'video', name: 'Video', items: [clipA, clipB] })],
      selection: [
        { trackId: 'v1', itemId: 'a' },
        { trackId: 'v1', itemId: 'b' },
      ],
    });
    expect(actions.isSingleGroupSelection.value).toBe(true);
  });

  it('reports isSingleGroupSelection as false when selected clips have different linkedGroupId values', () => {
    const clipA = makeClip({ id: 'a', trackId: 'v1', linkedGroupId: 'g1' });
    const clipB = makeClip({ id: 'b', trackId: 'v1', linkedGroupId: 'g2' });
    const { actions } = build({
      tracks: [makeTrack({ id: 'v1', kind: 'video', name: 'Video', items: [clipA, clipB] })],
      selection: [
        { trackId: 'v1', itemId: 'a' },
        { trackId: 'v1', itemId: 'b' },
      ],
    });
    expect(actions.isSingleGroupSelection.value).toBe(false);
  });

  it('reports isSingleGroupSelection as false when some selected clips have no linkedGroupId', () => {
    const clipA = makeClip({ id: 'a', trackId: 'v1', linkedGroupId: 'g1' });
    const clipB = makeClip({ id: 'b', trackId: 'v1' });
    const { actions } = build({
      tracks: [makeTrack({ id: 'v1', kind: 'video', name: 'Video', items: [clipA, clipB] })],
      selection: [
        { trackId: 'v1', itemId: 'a' },
        { trackId: 'v1', itemId: 'b' },
      ],
    });
    expect(actions.isSingleGroupSelection.value).toBe(false);
  });

  it('reports audio controls for video media clips and audio clips', () => {
    const { actions } = build();
    expect(actions.hasAudioOrVideoWithAudio.value).toBe(true);
    expect(actions.audioClipRefs.value.map(({ clip }) => clip.id)).toEqual(['video-1', 'audio-1']);
  });
});
