import { describe, it, expect } from 'vitest';
import { formatAudioChannels } from '~/utils/audio';
import {
  getGainAtClipTime,
  resolveEffectiveFadeDurationsSeconds,
} from '~/utils/audio/envelope';

describe('utils/audio', () => {
  it('formatAudioChannels formats channel count', () => {
    expect(formatAudioChannels(undefined)).toBe('-');
    expect(formatAudioChannels(0)).toBe('-');
    expect(formatAudioChannels(1)).toBe('Mono');
    expect(formatAudioChannels(2)).toBe('Stereo');
    expect(formatAudioChannels(6)).toBe('6 tracks');
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
});
