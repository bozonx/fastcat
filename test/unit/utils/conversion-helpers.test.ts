// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  clampPositiveNumber,
  resolveAudioChannelsFromMeta,
  resolveAudioOnlyContainerFormat,
} from '../../../src/utils/conversion/helpers';

describe('conversion/helpers', () => {
  it('resolveAudioChannelsFromMeta maps mono and falls back to stereo', () => {
    expect(resolveAudioChannelsFromMeta(1)).toBe('mono');
    expect(resolveAudioChannelsFromMeta(2)).toBe('stereo');
    expect(resolveAudioChannelsFromMeta(undefined)).toBe('stereo');
  });

  it('resolveAudioOnlyContainerFormat returns container by codec', () => {
    expect(resolveAudioOnlyContainerFormat('opus')).toBe('mkv');
    expect(resolveAudioOnlyContainerFormat('aac')).toBe('mp4');
  });

  it('clampPositiveNumber keeps positive finite values and falls back otherwise', () => {
    expect(clampPositiveNumber(42, 10)).toBe(42);
    expect(clampPositiveNumber(0, 10)).toBe(10);
    expect(clampPositiveNumber(Number.NaN, 10)).toBe(10);
    expect(clampPositiveNumber(-5, 10)).toBe(10);
  });
});
