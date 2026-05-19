/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  resolveAudioChannelsFromMeta,
  resolveAudioOnlyContainerFormat,
  resolveAudioOnlyFileExtension,
  clampPositiveNumber,
  isAbortError,
} from '~/utils/conversion/helpers';

describe('resolveAudioChannelsFromMeta', () => {
  it('returns 2 for falsy values', () => {
    expect(resolveAudioChannelsFromMeta(0)).toBe(2);
    expect(resolveAudioChannelsFromMeta(undefined)).toBe(2);
  });

  it('returns the value if truthy', () => {
    expect(resolveAudioChannelsFromMeta(1)).toBe(1);
    expect(resolveAudioChannelsFromMeta(6)).toBe(6);
  });
});

describe('resolveAudioOnlyContainerFormat', () => {
  it('returns webm for opus', () => {
    expect(resolveAudioOnlyContainerFormat('opus')).toBe('webm');
  });

  it('returns mp4 for aac', () => {
    expect(resolveAudioOnlyContainerFormat('aac')).toBe('mp4');
  });
});

describe('resolveAudioOnlyFileExtension', () => {
  it('returns opus for opus codec', () => {
    expect(resolveAudioOnlyFileExtension('opus')).toBe('opus');
  });

  it('returns m4a for aac codec', () => {
    expect(resolveAudioOnlyFileExtension('aac')).toBe('m4a');
  });
});

describe('clampPositiveNumber', () => {
  it('returns fallback for non-positive values', () => {
    expect(clampPositiveNumber(-5, 10)).toBe(10);
    expect(clampPositiveNumber(0, 10)).toBe(10);
    expect(clampPositiveNumber(NaN, 10)).toBe(10);
  });

  it('returns the value if positive', () => {
    expect(clampPositiveNumber(5, 10)).toBe(5);
  });
});

describe('isAbortError', () => {
  it('returns true for AbortError', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isAbortError(new Error('test'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
