// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  clampPositiveNumber,
  resolveAudioChannelsFromMeta,
  resolveAudioOnlyContainerFormat,
} from '~/utils/conversion/helpers';

describe('conversion/helpers', () => {
  it('resolveAudioChannelsFromMeta returns numeric channels and falls back to stereo channel count', () => {
    expect(resolveAudioChannelsFromMeta(1)).toBe(1);
    expect(resolveAudioChannelsFromMeta(2)).toBe(2);
    expect(resolveAudioChannelsFromMeta(undefined)).toBe(2);
  });

  it('resolveAudioOnlyContainerFormat returns container by codec', () => {
    expect(resolveAudioOnlyContainerFormat('opus')).toBe('webm');
    expect(resolveAudioOnlyContainerFormat('aac')).toBe('mp4');
  });

  it('clampPositiveNumber keeps positive finite values and falls back otherwise', () => {
    expect(clampPositiveNumber(42, 10)).toBe(42);
    expect(clampPositiveNumber(0, 10)).toBe(10);
    expect(clampPositiveNumber(Number.NaN, 10)).toBe(10);
    expect(clampPositiveNumber(-5, 10)).toBe(10);
  });
});
