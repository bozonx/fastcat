/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  formatAudioChannels,
  linearToDb,
  dbToLinear,
  getAudioMeterZone,
  getAudioMeterColorClass,
  getAudioMeterPercent,
  isAudioClipping,
  clipHasAudio,
  trackHasAudio,
  clipGainToYPercent,
  clipYPercentToGain,
} from '~/utils/audio';
import { getGainAtClipTime, resolveEffectiveFadeDurationsSeconds } from '~/utils/audio/envelope';

describe('utils/audio', () => {
  it('formatAudioChannels formats channel count', () => {
    expect(formatAudioChannels(undefined)).toBe('-');
    expect(formatAudioChannels(0)).toBe('-');
    expect(formatAudioChannels(1)).toBe('Mono');
    expect(formatAudioChannels(2)).toBe('Stereo');
    expect(formatAudioChannels(6)).toBe('6 tracks');
  });

  it('linearToDb converts linear to decibels', () => {
    expect(linearToDb(1)).toBeCloseTo(0, 5);
    expect(linearToDb(0.001)).toBeCloseTo(-60, 5);
    expect(linearToDb(0)).toBe(-60);
  });

  it('dbToLinear converts decibels to linear', () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 5);
    expect(dbToLinear(-59)).toBeCloseTo(0.001122, 5);
    expect(dbToLinear(-60)).toBe(0);
    expect(dbToLinear(-80)).toBe(0);
  });

  it('getAudioMeterZone returns correct zones', () => {
    expect(getAudioMeterZone(-10)).toBe('safe');
    expect(getAudioMeterZone(3)).toBe('warning');
    expect(getAudioMeterZone(8)).toBe('danger');
    expect(getAudioMeterZone(undefined)).toBe('safe');
  });

  it('getAudioMeterColorClass returns correct classes', () => {
    expect(getAudioMeterColorClass(-10)).toBe('bg-green-500');
    expect(getAudioMeterColorClass(3)).toBe('bg-yellow-500');
    expect(getAudioMeterColorClass(8)).toBe('bg-red-500');
  });

  it('getAudioMeterPercent returns percentage within range', () => {
    expect(getAudioMeterPercent(-60)).toBe(0);
    expect(getAudioMeterPercent(12)).toBe(100);
    expect(getAudioMeterPercent(-24)).toBeCloseTo(25.1, 1);
  });

  it('isAudioClipping detects clipping', () => {
    expect(isAudioClipping(0)).toBe(true);
    expect(isAudioClipping(-1)).toBe(false);
    expect(isAudioClipping(undefined)).toBe(false);
  });

  it('clipHasAudio respects kind and metadata', () => {
    const audioTrack = { kind: 'audio' as const, items: [] };
    const videoTrack = { kind: 'video' as const, items: [] };
    const clip = {
      kind: 'clip' as const,
      clipType: 'media' as const,
      source: { path: 'a.mp4' },
    };
    const gap = { kind: 'gap' as const };

    expect(clipHasAudio(gap, audioTrack, {})).toBe(false);
    // audio track returns true even without metadata for media clips
    expect(clipHasAudio(clip, audioTrack, {})).toBe(true);
    // video track needs metadata with audio: true
    expect(clipHasAudio(clip, videoTrack, { 'a.mp4': { audio: true } as any })).toBe(true);
    expect(clipHasAudio(clip, videoTrack, {})).toBe(false);
  });

  it('trackHasAudio checks items', () => {
    const track = {
      kind: 'audio' as const,
      items: [{ kind: 'clip' as const, clipType: 'media' as const, source: { path: 'a.mp4' } }],
    };
    expect(trackHasAudio(track, { 'a.mp4': { audio: true } as any })).toBe(true);
    // audio track returns true for media clips even without metadata
    expect(trackHasAudio(track, {})).toBe(true);
  });

  it('uses transition duration when fade is unset and applies transition curve', () => {
    const effective = resolveEffectiveFadeDurationsSeconds({
      clipDurationS: 4,
      clip: {
        transitionIn: {
          durationUs: 1_500_000,
          mode: 'transition',
          curve: 'bezier',
        },
        audioFadeInCurve: 'logarithmic',
      },
    });

    expect(effective.fadeInS).toBe(1.5);
    expect(effective.fadeInCurve).toBe('logarithmic');
  });

  it('prefers manual fade duration over transition duration', () => {
    const effective = resolveEffectiveFadeDurationsSeconds({
      clipDurationS: 4,
      clip: {
        audioFadeOutUs: 500_000,
        audioFadeOutCurve: 'logarithmic',
        transitionOut: {
          durationUs: 2_000_000,
          mode: 'transition',
          curve: 'bezier',
        },
      },
    });

    expect(effective.fadeOutS).toBe(0.5);
    expect(effective.fadeOutCurve).toBe('logarithmic');
  });

  it('uses outgoing transition owner fade out mode for both clips in transition', () => {
    const fromClip = {
      audioFadeOutCurve: 'logarithmic' as const,
      transitionOut: {
        durationUs: 800_000,
        mode: 'transition',
        curve: 'linear',
      },
    };

    const toClipEffective = resolveEffectiveFadeDurationsSeconds({
      clipDurationS: 3,
      clip: {
        audioFadeInCurve: 'linear',
      },
      previousClip: fromClip,
    });

    const fromClipEffective = resolveEffectiveFadeDurationsSeconds({
      clipDurationS: 3,
      clip: fromClip,
      nextClip: {
        audioFadeInCurve: 'linear',
      },
    });

    expect(fromClipEffective.fadeOutCurve).toBe('logarithmic');
    expect(toClipEffective.fadeInCurve).toBe('logarithmic');
  });

  it('uses incoming transition owner fade in mode for both clips in transition', () => {
    const toClip = {
      audioFadeInCurve: 'logarithmic' as const,
      transitionIn: {
        durationUs: 900_000,
        mode: 'transition',
        curve: 'linear',
      },
    };

    const fromClipEffective = resolveEffectiveFadeDurationsSeconds({
      clipDurationS: 3,
      clip: {
        audioFadeOutCurve: 'linear',
      },
      nextClip: toClip,
    });

    const toClipEffective = resolveEffectiveFadeDurationsSeconds({
      clipDurationS: 3,
      clip: toClip,
      previousClip: {
        audioFadeOutCurve: 'linear',
      },
    });

    expect(fromClipEffective.fadeOutCurve).toBe('logarithmic');
    expect(toClipEffective.fadeInCurve).toBe('logarithmic');
  });

  it('applies logarithmic curve differently from linear gain ramp', () => {
    const linear = getGainAtClipTime({
      clipDurationS: 4,
      fadeInS: 2,
      fadeOutS: 0,
      fadeInCurve: 'linear',
      baseGain: 1,
      tClipS: 1,
    });
    const logarithmic = getGainAtClipTime({
      clipDurationS: 4,
      fadeInS: 2,
      fadeOutS: 0,
      fadeInCurve: 'logarithmic',
      baseGain: 1,
      tClipS: 1,
    });

    expect(linear).toBeCloseTo(0.5, 5);
    expect(logarithmic).toBeGreaterThan(linear);
    expect(logarithmic).toBeCloseTo(Math.sin(Math.PI / 4), 5);
  });

  it('clipGainToYPercent and clipYPercentToGain map correctly', () => {
    expect(clipGainToYPercent(0)).toBe(100);
    expect(clipGainToYPercent(-1)).toBe(100);
    expect(clipGainToYPercent(1.0)).toBeCloseTo(33.33, 1);
    expect(clipGainToYPercent(1.5)).toBeCloseTo(0, 1);
    expect(clipGainToYPercent(2.0)).toBeCloseTo(0, 1);

    expect(clipYPercentToGain(100)).toBeCloseTo(0, 5);
    expect(clipYPercentToGain(50)).toBeCloseTo(0.75, 5);
    expect(clipYPercentToGain(33.333333333333336)).toBeCloseTo(1.0, 5);
    expect(clipYPercentToGain(0)).toBeCloseTo(1.5, 5);
  });

  it('dbToPercent and percentToDb map correctly using cubic curve', () => {
    // Mixer track defaults (minDb = -60, maxDb = 12)
    // At maxDb = 12, ratio is 1 -> 100%
    expect(dbToPercent(12, -60, 12)).toBeCloseTo(100, 1);
    expect(percentToDb(100, -60, 12)).toBeCloseTo(12, 1);

    // At 0 dB, ratio is 1/3.981 = 0.2512 -> cubic ratio is 0.631 -> 63.1%
    expect(dbToPercent(0, -60, 12)).toBeCloseTo(63.1, 1);
    expect(percentToDb(63.0957, -60, 12)).toBeCloseTo(0, 1);

    // At minDb = -60, percent is 0%
    expect(dbToPercent(-60, -60, 12)).toBeCloseTo(0, 1);
    expect(percentToDb(0, -60, 12)).toBeCloseTo(-60, 1);
  });
});
