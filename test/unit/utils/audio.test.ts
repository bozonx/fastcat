import { describe, it, expect } from 'vitest';
import { formatAudioChannels } from '../../../src/utils/audio';
import {
  getGainAtClipTime,
  resolveEffectiveFadeDurationsSeconds,
} from '../../../src/utils/audio/envelope';

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
        audioFadeOutCurve: 'linear',
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
