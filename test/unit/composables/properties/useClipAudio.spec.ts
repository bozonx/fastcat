import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import { TICKS_PER_SECOND } from '~/utils/time';
import { CLIP_AUDIO_GAIN_MAX } from '~/utils/audio/envelope';
import type { TimelineClipItem, TimelineTrack, TimelineDocument } from '~/timeline/types';

function createClip(overrides: Record<string, any> = {}): TimelineClipItem {
  return {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    clipType: 'media',
    name: 'Test',
    timelineRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
    sourceRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
    audioGain: 1,
    audioBalance: 0,
    audioFadeInTicks: 0,
    audioFadeOutTicks: 0,
    audioFadeInCurve: 'linear',
    audioFadeOutCurve: 'linear',
    ...overrides,
  } as TimelineClipItem;
}

function createTrack(overrides: Record<string, any> = {}): TimelineTrack {
  return {
    id: 'track-1',
    kind: 'audio',
    name: 'Track 1',
    items: [],
    ...overrides,
  } as TimelineTrack;
}

describe('useClipAudio', () => {
  let emittedAudio: Record<string, any>[];
  let pushHistoryCalls: { preState: TimelineDocument; commandType: string; labelKey: string }[];

  beforeEach(() => {
    emittedAudio = [];
    pushHistoryCalls = [];
  });

  function createComposable(
    clip: TimelineClipItem,
    options: {
      tracks?: TimelineTrack[];
      mediaMetadataByPath?: Record<string, unknown>;
      isParamAnimated?: (path: string) => boolean;
      onAnimatedParamEdit?: (path: string, value: number) => void;
      getAnimatedDisplayValue?: (path: string, staticValue: number) => number;
      pushHistory?: (preState: TimelineDocument, commandType: string, labelKey: string) => void;
      getTimelineDoc?: () => TimelineDocument | null;
    } = {},
  ) {
    const clipRef = ref(clip);
    const tracksRef = ref(options.tracks ?? [createTrack()]);
    const mediaMetadataRef = ref(options.mediaMetadataByPath ?? {});

    return useClipAudio({
      clip: clipRef,
      tracks: tracksRef,
      mediaMetadataByPath: mediaMetadataRef,
      updateAudio: (patch) => emittedAudio.push(patch),
      pushHistory: options.pushHistory ?? ((preState, commandType, labelKey) =>
        pushHistoryCalls.push({ preState, commandType, labelKey })),
      getTimelineDoc: options.getTimelineDoc,
      isParamAnimated: options.isParamAnimated,
      onAnimatedParamEdit: options.onAnimatedParamEdit,
      getAnimatedDisplayValue: options.getAnimatedDisplayValue,
    });
  }

  it('reads audio gain', () => {
    const c = createComposable(createClip({ audioGain: 1.5 }));
    expect(c.audioGain.value).toBe(1.5);
  });

  it('defaults audio gain to 1 when missing', () => {
    const c = createComposable(createClip({ audioGain: undefined }));
    expect(c.audioGain.value).toBe(1);
  });

  it('clamps audio gain to [0, CLIP_AUDIO_GAIN_MAX]', () => {
    const c = createComposable(createClip({ audioGain: 10 }));
    expect(c.audioGain.value).toBe(CLIP_AUDIO_GAIN_MAX);
  });

  it('clamps negative audio gain to 0', () => {
    const c = createComposable(createClip({ audioGain: -1 }));
    expect(c.audioGain.value).toBe(0);
  });

  it('handles NaN audio gain', () => {
    const c = createComposable(createClip({ audioGain: NaN }));
    expect(c.audioGain.value).toBe(1);
  });

  it('reads audio balance', () => {
    const c = createComposable(createClip({ audioBalance: 0.5 }));
    expect(c.audioBalance.value).toBe(0.5);
  });

  it('defaults audio balance to 0 when missing', () => {
    const c = createComposable(createClip({ audioBalance: undefined }));
    expect(c.audioBalance.value).toBe(0);
  });

  it('clamps audio balance to [-1, 1]', () => {
    const c = createComposable(createClip({ audioBalance: 2 }));
    expect(c.audioBalance.value).toBe(1);
  });

  it('clamps negative audio balance to -1', () => {
    const c = createComposable(createClip({ audioBalance: -2 }));
    expect(c.audioBalance.value).toBe(-1);
  });

  it('updates audio gain', () => {
    const c = createComposable(createClip());
    c.updateAudioGain(1.5);
    expect(emittedAudio).toEqual([{ audioGain: 1.5 }]);
  });

  it('clamps updated audio gain to max', () => {
    const c = createComposable(createClip());
    c.updateAudioGain(999);
    expect(emittedAudio).toEqual([{ audioGain: CLIP_AUDIO_GAIN_MAX }]);
  });

  it('clamps updated audio gain to 0', () => {
    const c = createComposable(createClip());
    c.updateAudioGain(-5);
    expect(emittedAudio).toEqual([{ audioGain: 0 }]);
  });

  it('handles string input for audio gain', () => {
    const c = createComposable(createClip());
    c.updateAudioGain('1.5');
    expect(emittedAudio).toEqual([{ audioGain: 1.5 }]);
  });

  it('handles invalid string input for audio gain', () => {
    const c = createComposable(createClip());
    c.updateAudioGain('abc');
    expect(emittedAudio).toEqual([{ audioGain: 0 }]);
  });

  it('updates audio balance', () => {
    const c = createComposable(createClip());
    c.updateAudioBalance(0.5);
    expect(emittedAudio).toEqual([{ audioBalance: 0.5 }]);
  });

  it('clamps updated audio balance to [-1, 1]', () => {
    const c = createComposable(createClip());
    c.updateAudioBalance(5);
    expect(emittedAudio).toEqual([{ audioBalance: 1 }]);
  });

  it('canEditAudioFades is true for media clip', () => {
    const c = createComposable(createClip({ clipType: 'media' }));
    expect(c.canEditAudioFades.value).toBe(true);
  });

  it('canEditAudioFades is true for timeline clip', () => {
    const c = createComposable(createClip({ clipType: 'timeline' }));
    expect(c.canEditAudioFades.value).toBe(true);
  });

  it('canEditAudioFades is false for adjustment clip', () => {
    const c = createComposable(createClip({ clipType: 'adjustment' }));
    expect(c.canEditAudioFades.value).toBe(false);
  });

  it('canEditAudioGain is false when clip has no audio in metadata', () => {
    const c = createComposable(
      createClip({ source: { path: '/video.mp4' } }),
      { mediaMetadataByPath: { '/video.mp4': { audio: false } } },
    );
    expect(c.canEditAudioGain.value).toBe(false);
  });

  it('canEditAudioGain is true when metadata has audio', () => {
    const c = createComposable(
      createClip({ source: { path: '/video.mp4' } }),
      { mediaMetadataByPath: { '/video.mp4': { audio: true } } },
    );
    expect(c.canEditAudioGain.value).toBe(true);
  });

  it('canEditAudioGain is false for video track when audioMuted', () => {
    const c = createComposable(
      createClip({ audioMuted: true }),
      { tracks: [createTrack({ kind: 'video' })] },
    );
    expect(c.canEditAudioGain.value).toBe(false);
  });

  it('canEditAudioGain is true for audio track even when audioMuted', () => {
    const c = createComposable(
      createClip({ audioMuted: true }),
      { tracks: [createTrack({ kind: 'audio' })] },
    );
    expect(c.canEditAudioGain.value).toBe(true);
  });

  it('canEditAudioBalance equals canEditAudioGain', () => {
    const c = createComposable(createClip());
    expect(c.canEditAudioBalance.value).toBe(c.canEditAudioGain.value);
  });

  it('reads fade in seconds from ticks', () => {
    const c = createComposable(createClip({ audioFadeInTicks: 2 * TICKS_PER_SECOND }));
    expect(c.audioFadeInSec.value).toBe(2);
  });

  it('reads fade out seconds from ticks', () => {
    const c = createComposable(createClip({ audioFadeOutTicks: 1.5 * TICKS_PER_SECOND }));
    expect(c.audioFadeOutSec.value).toBe(1.5);
  });

  it('defaults fade in to 0 when missing', () => {
    const c = createComposable(createClip({ audioFadeInTicks: undefined }));
    expect(c.audioFadeInSec.value).toBe(0);
  });

  it('defaults fade out to 0 when missing', () => {
    const c = createComposable(createClip({ audioFadeOutTicks: undefined }));
    expect(c.audioFadeOutSec.value).toBe(0);
  });

  it('fade in max sec accounts for fade out duration', () => {
    const c = createComposable(
      createClip({
        audioFadeOutTicks: 2 * TICKS_PER_SECOND,
        timelineRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
      }),
    );
    expect(c.audioFadeInMaxSec.value).toBe(3);
  });

  it('fade out max sec accounts for fade in duration', () => {
    const c = createComposable(
      createClip({
        audioFadeInTicks: 1 * TICKS_PER_SECOND,
        timelineRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
      }),
    );
    expect(c.audioFadeOutMaxSec.value).toBe(4);
  });

  it('updates fade in seconds converting to ticks', () => {
    const c = createComposable(createClip());
    c.updateAudioFadeInSec(2);
    expect(emittedAudio).toEqual([{ audioFadeInTicks: 2 * TICKS_PER_SECOND }]);
  });

  it('clamps fade in to max sec', () => {
    const c = createComposable(
      createClip({
        audioFadeOutTicks: 4 * TICKS_PER_SECOND,
        timelineRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
      }),
    );
    c.updateAudioFadeInSec(10);
    expect(emittedAudio[0].audioFadeInTicks).toBe(1 * TICKS_PER_SECOND);
  });

  it('updates fade out seconds converting to ticks', () => {
    const c = createComposable(createClip());
    c.updateAudioFadeOutSec(1.5);
    expect(emittedAudio).toEqual([{ audioFadeOutTicks: Math.round(1.5 * TICKS_PER_SECOND) }]);
  });

  it('clamps fade out to max sec', () => {
    const c = createComposable(
      createClip({
        audioFadeInTicks: 3 * TICKS_PER_SECOND,
        timelineRange: { startTicks: 0, durationTicks: 5 * TICKS_PER_SECOND },
      }),
    );
    c.updateAudioFadeOutSec(10);
    expect(emittedAudio[0].audioFadeOutTicks).toBe(2 * TICKS_PER_SECOND);
  });

  it('reads fade in curve', () => {
    const c = createComposable(createClip({ audioFadeInCurve: 'logarithmic' }));
    expect(c.audioFadeInCurve.value).toBe('logarithmic');
  });

  it('defaults fade in curve to linear', () => {
    const c = createComposable(createClip({ audioFadeInCurve: undefined }));
    expect(c.audioFadeInCurve.value).toBe('linear');
  });

  it('reads fade out curve', () => {
    const c = createComposable(createClip({ audioFadeOutCurve: 'logarithmic' }));
    expect(c.audioFadeOutCurve.value).toBe('logarithmic');
  });

  it('defaults fade out curve to linear', () => {
    const c = createComposable(createClip({ audioFadeOutCurve: 'invalid' }));
    expect(c.audioFadeOutCurve.value).toBe('linear');
  });

  it('updates fade in curve', () => {
    const c = createComposable(createClip());
    c.updateAudioFadeInCurve('logarithmic');
    expect(emittedAudio).toEqual([{ audioFadeInCurve: 'logarithmic' }]);
  });

  it('normalizes invalid fade in curve on update', () => {
    const c = createComposable(createClip());
    c.updateAudioFadeInCurve('invalid');
    expect(emittedAudio).toEqual([{ audioFadeInCurve: 'linear' }]);
  });

  it('updates fade out curve', () => {
    const c = createComposable(createClip());
    c.updateAudioFadeOutCurve('logarithmic');
    expect(emittedAudio).toEqual([{ audioFadeOutCurve: 'logarithmic' }]);
  });

  it('normalizes invalid fade out curve on update', () => {
    const c = createComposable(createClip());
    c.updateAudioFadeOutCurve(42);
    expect(emittedAudio).toEqual([{ audioFadeOutCurve: 'linear' }]);
  });

  it('routes animated volume edit to onAnimatedParamEdit', () => {
    const spy = vi.fn();
    const c = createComposable(createClip(), {
      isParamAnimated: (path) => path === 'audio.volume',
      onAnimatedParamEdit: spy,
    });
    c.updateAudioGain(1.5);
    expect(spy).toHaveBeenCalledWith('audio.volume', 1.5);
    expect(emittedAudio).toHaveLength(0);
  });

  it('routes animated pan edit to onAnimatedParamEdit', () => {
    const spy = vi.fn();
    const c = createComposable(createClip(), {
      isParamAnimated: (path) => path === 'audio.pan',
      onAnimatedParamEdit: spy,
    });
    c.updateAudioBalance(0.5);
    expect(spy).toHaveBeenCalledWith('audio.pan', 0.5);
    expect(emittedAudio).toHaveLength(0);
  });

  it('getAnimatedDisplayValue overrides static gain', () => {
    const c = createComposable(createClip({ audioGain: 1 }), {
      isParamAnimated: (path) => path === 'audio.volume',
      getAnimatedDisplayValue: (_path, staticValue) =>
        _path === 'audio.volume' ? 1.8 : staticValue,
    });
    expect(c.audioGain.value).toBe(1.8);
  });

  it('getAnimatedDisplayValue overrides static balance', () => {
    const c = createComposable(createClip({ audioBalance: 0 }), {
      isParamAnimated: (path) => path === 'audio.pan',
      getAnimatedDisplayValue: (_path, staticValue) =>
        _path === 'audio.pan' ? 0.7 : staticValue,
    });
    expect(c.audioBalance.value).toBe(0.7);
  });

  it('selectedClipTrack finds the track by id', () => {
    const c = createComposable(createClip({ trackId: 'track-2' }), {
      tracks: [createTrack({ id: 'track-1' }), createTrack({ id: 'track-2', name: 'Track 2' })],
    });
    expect(c.selectedClipTrack.value?.id).toBe('track-2');
    expect(c.selectedClipTrack.value?.name).toBe('Track 2');
  });

  it('selectedClipTrack returns null when track not found', () => {
    const c = createComposable(createClip({ trackId: 'missing' }));
    expect(c.selectedClipTrack.value).toBeNull();
  });

  it('onVolumeDragStart captures timeline doc', () => {
    const mockDoc = { id: 'doc-1' } as unknown as TimelineDocument;
    const c = createComposable(createClip(), {
      getTimelineDoc: () => mockDoc,
    });
    c.onVolumeDragStart();
    c.onVolumeDragEnd();
    expect(pushHistoryCalls).toHaveLength(1);
    expect(pushHistoryCalls[0].preState).toEqual(mockDoc);
    expect(pushHistoryCalls[0].commandType).toBe('update_clip_properties');
  });

  it('onVolumeDragEnd does nothing without drag start', () => {
    const c = createComposable(createClip());
    c.onVolumeDragEnd();
    expect(pushHistoryCalls).toHaveLength(0);
  });

  it('onVolumeDragEnd does nothing when getTimelineDoc is not provided', () => {
    const c = createComposable(createClip());
    c.onVolumeDragStart();
    c.onVolumeDragEnd();
    expect(pushHistoryCalls).toHaveLength(0);
  });

  it('onVolumeDragEnd clears doc after push', () => {
    const mockDoc = { id: 'doc-1' } as unknown as TimelineDocument;
    const c = createComposable(createClip(), {
      getTimelineDoc: () => mockDoc,
    });
    c.onVolumeDragStart();
    c.onVolumeDragEnd();
    // Second call should not push again
    c.onVolumeDragEnd();
    expect(pushHistoryCalls).toHaveLength(1);
  });
});
